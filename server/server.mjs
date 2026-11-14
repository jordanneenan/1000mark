// 1000Mark server (formerly Pressmark): serves the site and keeps accounts and their runs.
// No dependencies: Node's built-in http, sqlite and crypto. Node 22.13 or newer.
//
// Security notes
// - Passwords: scrypt (N=32768) with a per-user salt. Never logged, never returned.
// - Sessions: a random token in an HttpOnly, Secure, SameSite=Lax cookie; only its hash is stored.
// - Bot check: a proof-of-work puzzle (signed, single-use, short-lived) on register and login,
//   plus a honeypot field and per-address / per-email rate limits. No third-party captcha.
// - Changes need a JSON content type and a same-origin Origin header (blocks cross-site forms).
// - Emails are stored encrypted (AES-256-GCM) with a keyed fingerprint (HMAC-SHA256) for lookups.
//   The keys live in KEYS_FILE, outside the database and outside this repository, so a copy of the
//   database alone does not reveal anyone's email. No IP addresses are stored.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const PORT = +process.env.PORT || 8791;
const HOST = process.env.HOST || '0.0.0.0';
const SITE = path.resolve(process.env.SITE_DIR || path.join(import.meta.dirname, '..'));
const DATA = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, 'data'));
const SESSION_DAYS = 30, POW_MAX = 100000, POW_TTL = 5 * 60e3, MAX_RUNS = 2000, MAX_RUN_BYTES = 200e3;

fs.mkdirSync(DATA, { recursive: true });

// ---------- keys: outside the database, never in the repository ----------
// Production refuses to start without the file. Elsewhere (development) it is made on first run.
const KEYS_FILE = path.resolve(process.env.KEYS_FILE || path.join(DATA, '..', 'keys', 'keys.json'));
if (!fs.existsSync(KEYS_FILE)) {
  if (process.env.NODE_ENV === 'production') { console.error(`Missing ${KEYS_FILE}. Refusing to start.`); process.exit(1); }
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify({ emailKey: crypto.randomBytes(32).toString('base64'), emailIndexKey: crypto.randomBytes(32).toString('base64') }), { mode: 0o600 });
  console.log(`Made new keys in ${KEYS_FILE}. Back this file up: without it, stored emails cannot be read.`);
}
const KEYS = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
const EMAIL_KEY = Buffer.from(KEYS.emailKey, 'base64'), INDEX_KEY = Buffer.from(KEYS.emailIndexKey, 'base64');
if (EMAIL_KEY.length !== 32 || INDEX_KEY.length !== 32) { console.error('Bad keys file.'); process.exit(1); }
const emailIdx = e => crypto.createHmac('sha256', INDEX_KEY).update(e).digest('base64url');
function sealEmail(e) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', EMAIL_KEY, iv);
  const ct = Buffer.concat([c.update(e, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}
function openEmail(s) {
  const [v, iv, tag, ct] = String(s).split('.'); if (v !== 'v1') return '';
  const d = crypto.createDecipheriv('aes-256-gcm', EMAIL_KEY, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
const db = new DatabaseSync(path.join(DATA, 'pressmark.db'));
db.exec(`
  PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email_idx TEXT NOT NULL UNIQUE, email_enc TEXT NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, created INTEGER NOT NULL, username TEXT);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS runs (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, time TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, id));
  CREATE TABLE IF NOT EXISTS board (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, run_id TEXT NOT NULL, kind TEXT NOT NULL, submitted INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, run_id));
  CREATE TABLE IF NOT EXISTS guard (email_idx TEXT PRIMARY KEY, fails INTEGER NOT NULL, tier INTEGER NOT NULL, locked_until INTEGER NOT NULL, last_fail INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS support (id INTEGER PRIMARY KEY, created INTEGER NOT NULL, email_enc TEXT NOT NULL, email_idx TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
  CREATE TABLE IF NOT EXISTS handoffs (token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS keys (key_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER);
`);
const q = sql => db.prepare(sql);
// Older databases kept emails in plain text and had no usernames: move them to the current layout.
if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'email'").get()) {
  const hasUser = !!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'username'").get();
  const old = db.prepare(`SELECT id, email, name, pass, created${hasUser ? ', username' : ''} FROM users`).all();
  db.exec('PRAGMA foreign_keys = OFF; BEGIN');
  try {
    db.exec('CREATE TABLE users_new (id INTEGER PRIMARY KEY, email_idx TEXT NOT NULL UNIQUE, email_enc TEXT NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, created INTEGER NOT NULL, username TEXT)');
    const put = db.prepare('INSERT INTO users_new (id, email_idx, email_enc, name, pass, created, username) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const u of old) { const e = String(u.email).trim().toLowerCase(); put.run(u.id, emailIdx(e), sealEmail(e), u.name, u.pass, u.created, u.username ?? null); }
    db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT; PRAGMA foreign_keys = ON');
    console.log(`Encrypted the emails of ${old.length} account(s).`);
  } catch (e) { db.exec('ROLLBACK; PRAGMA foreign_keys = ON'); throw e; }
  db.exec('VACUUM');                                                     // drop the old plain-text pages from the file
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username COLLATE NOCASE)');
let secret = q('SELECT v FROM meta WHERE k = ?').get('secret')?.v;
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); q('INSERT INTO meta (k, v) VALUES (?, ?)').run('secret', secret); }

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = s => crypto.createHmac('sha256', secret).update(s).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const scryptRaw = promisify(crypto.scrypt);
// At most three password hashes at once (32 MB each); a queue beyond 60 is turned away, so a flood of
// sign-ins slows down instead of running the server out of memory.
let hashing = 0; const hashQueue = [];
async function scrypt(...a) {
  if (hashing >= 3) { if (hashQueue.length >= 60) throw new Fail(503, 'The server is busy. Try again in a minute.'); await new Promise(r => hashQueue.push(r)); }
  hashing++;
  try { return await scryptRaw(...a); } finally { hashing--; const next = hashQueue.shift(); if (next) next(); }
}
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
async function hashPassword(pw) { const salt = crypto.randomBytes(16); const h = await scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT); return `scrypt$${SCRYPT.N}$${salt.toString('hex')}$${h.toString('hex')}`; }
async function checkPassword(pw, stored) {
  const [kind, n, salt, hash] = String(stored).split('$'); if (kind !== 'scrypt') return false;
  const h = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'hex'), 64, { ...SCRYPT, N: +n });
  return safeEq(h.toString('hex'), hash);
}
// Burn the same time whether or not the account exists, so timing does not reveal which emails are registered.
const DUMMY = await hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- bot check: proof of work ----------
const usedPow = new Map();
function newChallenge() {
  const salt = `${crypto.randomBytes(12).toString('hex')}.${Date.now() + POW_TTL}`;
  const challenge = sha(salt + crypto.randomInt(0, POW_MAX + 1));
  return { salt, challenge, max: POW_MAX, sig: hmac(`${salt}.${challenge}`) };
}
function checkPow(p) {
  if (!p || typeof p.salt !== 'string' || typeof p.challenge !== 'string' || typeof p.sig !== 'string' || !Number.isInteger(p.number)) return false;
  if (!safeEq(hmac(`${p.salt}.${p.challenge}`), p.sig)) return false;
  if (+p.salt.split('.')[1] < Date.now() || usedPow.has(p.sig)) return false;
  if (p.number < 0 || p.number > POW_MAX || sha(p.salt + p.number) !== p.challenge) return false;
  usedPow.set(p.sig, +p.salt.split('.')[1]);
  return true;
}

// ---------- rate limits (in memory) ----------
const hits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now(), h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
  return ++h.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); for (const [k, v] of usedPow) if (v < now) usedPow.delete(k); q('DELETE FROM sessions WHERE expires < ?').run(now); q('DELETE FROM handoffs WHERE expires < ?').run(now); }, 60e3).unref();

// ---------- http helpers ----------
class Fail extends Error { constructor(code, message) { super(message); this.code = code; } }
// Sent with every response.
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const send = (res, code, body, headers = {}) => { const text = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...headers }); res.end(text); };
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(new Fail(415, 'Send JSON.'));
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Fail(413, 'That is too large.')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(new Fail(400, 'That was not valid JSON.')); } });
    req.on('error', reject);
  });
}
// Behind Cloudflare (TRUST_CF=1) the visitor's address is in CF-Connecting-IP. The server is reachable
// only through the tunnel and the tailnet, so the header cannot be forged from the internet.
const TRUST_CF = process.env.TRUST_CF === '1';
const ipOf = req => (TRUST_CF && req.headers['cf-connecting-ip']) || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;                       // not a browser (the app), or same-origin GET
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}
const cookie = (token, maxAge) => `pm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function sessionUser(req) {
  const m = /(?:^|;\s*)pm_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  return q('SELECT u.id, u.email_enc, u.name, u.username, u.created FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?').get(sha(m[1]), Date.now()) || null;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').run(sha(token), userId, Date.now(), Date.now() + SESSION_DAYS * 864e5);
  return { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) };
}
const publicUser = u => ({ email: u.email || openEmail(u.email_enc), name: u.username || u.name, username: u.username || null, created: u.created, runs: q('SELECT COUNT(*) AS n FROM runs WHERE user_id = ?').get(u.id).n });
const RESERVED = /^(admin|administrator|root|pressmark|1000mark|thousandmark|support|help|system|moderator|mod|staff|anonymous|null|undefined)$/i;
function cleanUsername(n) {
  n = String(n || '').trim();
  if (n.length < 3 || n.length > 24) throw new Fail(400, 'Usernames are 3 to 24 characters.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(n)) throw new Fail(400, 'Usernames can use letters, numbers, dots, dashes and underscores, with no spaces, and start with a letter or number.');
  if (RESERVED.test(n)) throw new Fail(409, 'That username is taken. Try another.');
  return n;
}
const usernameFree = (n, exceptId = 0) => !q('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(n, exceptId);

// Leaderboard entries keep only the hardware and the results: no device name, paths or drive list.
const BOARD_MAX = 2000, BOARD_PER_USER = 30;
let boardCache = null;
function boardEntry(r) {
  const run = JSON.parse(cleanRun(r).data), d = run.device || {}, i = run.info || {};
  const str = (v, n = 120) => typeof v === 'string' ? v.slice(0, n) : '';
  const num = v => typeof v === 'number' && isFinite(v) ? v : null;
  return { id: run.id, time: run.time, kind: run.native ? 'app' : 'browser', mode: str(run.mode, 10), norm: !!run.norm, native: !!run.native, tests: run.tests,
    device: { cpu: str(d.cpu), gpu: str(d.gpu || i.gpuAdapter), cores: num(d.cores), physCores: num(d.physCores), memoryBytes: num(d.memoryBytes), os: str(d.os, 60), arch: str(d.arch, 30), browser: str(d.browser, 60), model: d.native ? '' : str(d.model, 60), native: !!d.native },
    info: { gpuApi: str(i.gpuApi, 40), gpuAdapter: str(i.gpuAdapter) } };
}

const cleanEmail = e => { e = String(e || '').trim().toLowerCase(); if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Fail(400, 'That email address does not look right.'); return e; };
const cleanPassword = p => { p = String(p || ''); if (p.length < 10) throw new Fail(400, 'Use a password of at least 10 characters.'); if (p.length > 200) throw new Fail(400, 'That password is too long.'); return p; };

function cleanRun(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 80 || typeof r.time !== 'string' || isNaN(Date.parse(r.time))) throw new Fail(400, 'That is not a 1000Mark run.');
  if (!r.tests || typeof r.tests !== 'object' || !r.device || typeof r.device !== 'object') throw new Fail(400, 'That is not a 1000Mark run.');
  const tests = Object.entries(r.tests); if (tests.length > 300 || tests.some(([k, v]) => k.length > 40 || typeof v !== 'number' || !isFinite(v))) throw new Fail(400, 'That run has results that are not numbers.');
  r.label = String(r.label || 'Unnamed device').slice(0, 80);
  const data = JSON.stringify(r); if (data.length > MAX_RUN_BYTES) throw new Fail(413, 'That run is too large.');
  return { id: r.id, time: new Date(r.time).toISOString(), data };
}
function saveRuns(userId, list) {
  const have = q('SELECT COUNT(*) AS n FROM runs WHERE user_id = ?').get(userId).n;
  const exists = q('SELECT 1 FROM runs WHERE user_id = ? AND id = ?'), put = q('INSERT INTO runs (user_id, id, time, data) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET time = excluded.time, data = excluded.data');
  const rows = list.map(cleanRun); let added = 0;
  for (const r of rows) if (!exists.get(userId, r.id)) added++;
  if (have + added > MAX_RUNS) throw new Fail(409, `An account can hold ${MAX_RUNS} runs. Delete some old ones first.`);
  db.exec('BEGIN'); try { for (const r of rows) put.run(userId, r.id, r.time, r.data); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows.length;
}

// ---------- population: scored with the site's own scoring.js, cached for five minutes ----------
const scoring = await import(new URL('file://' + path.join(SITE, 'scoring.js')).href);
const rawTests = r => { const t = { ...r.tests }; if (r.native && !r.norm) for (const id of Object.keys(t)) if (scoring.TESTS[id]?.div) t[id] /= scoring.TESTS[id].div; return scoring.addSizes({ ...r, tests: t }).tests; };

// ---------- false scores ----------
// Results are measured on the visitor's own device, so a determined person can always send made-up
// numbers. These checks turn away the impossible ones, and the outlier check keeps runs far above
// other runs on the same processor or graphics chip off the leaderboard and out of the percentiles.
function implausible(r) {
  const { TESTS, scoreTest, scoreRun } = scoring, tests = rawTests(r), ids = Object.keys(tests), d = r.device || {};
  if (Date.parse(r.time) > Date.now() + 864e5) return 'it is dated in the future';
  if (r.native ? ids.some(id => TESTS[id] && !/^(n_|gpu_)/.test(id)) : ids.some(id => id.startsWith('n_'))) return 'it mixes results from the browser test and the computer test';
  const cores = d.cores; if (!Number.isInteger(cores) || cores < 1 || cores > 1024) return 'the thread count is not believable';
  for (const id of ids) { const p = scoreTest(id, tests[id]); if (p != null && p > 25000) return `${TESTS[id].name} is over 25 times the reference machine`; }
  for (const id of ids) { const t = TESTS[id]; if (t && t.pair && tests[t.pair] > 0 && tests[id] / tests[t.pair] > cores * 1.3) return `${t.name} on all cores is faster than ${cores} threads could be`; }
  for (const id of ids) { const one = id.replace('_6t_', '_'); if (one !== id && tests[one] > 0 && tests[id] / tests[one] > Math.min(6, cores) * 1.3) return `${TESTS[id] ? TESTS[id].name : id} on six threads is faster than ${Math.min(6, cores)} threads could be`; }
  if (tests.n_mem_size != null && (!(d.memoryBytes > 0) || Math.abs(tests.n_mem_size - scoring.ramGB(d.memoryBytes)) > 2 || tests.n_mem_size > 4096)) return 'the memory size does not match the computer';
  if (tests.n_sto_total > 500000) return 'the drive size is not believable';
  const sys = scoreRun({ ...r, tests }).system; if (!sys) return 'it has no scored results';
  if (sys > 12000) return 'the system score is over 12 times the reference machine';
  return '';
}
// Index set of entries whose CPU or GPU score is over 1.6 times the median of at least five others
// with the same chip, in the same kind of test.
function outliers(list) {
  const out = new Set();
  for (const [part, key] of [['cpu', e => e.device?.cpu], ['gpu', e => e.device?.gpu || e.info?.gpuAdapter]]) {
    const groups = new Map();
    list.forEach((e, i) => { const k = key(e); const v = e.cats?.[part]; if (!k || !(v > 0)) return; const g = `${e.kind}|${k.toLowerCase().replace(/\s+/g, ' ').trim()}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([i, v]); });
    for (const g of groups.values()) {
      if (g.length < 6) continue;
      for (const [i, v] of g) { const others = g.filter(x => x[0] !== i).map(x => x[1]).sort((a, b) => a - b); const med = others[others.length >> 1]; if (v > med * 1.6) out.add(i); }
    }
  }
  return out;
}

let popCache = null;
async function population() {
  if (popCache && popCache.until > Date.now()) return popCache.body;
  const { TESTS, PROFILES, scoreRun, scoreTest } = scoring;
  const latest = new Map();
  for (const row of q('SELECT user_id, data FROM runs ORDER BY time DESC').iterate()) {
    let r; try { r = JSON.parse(row.data); } catch { continue; }
    const key = `${row.user_id}|${r.label}|${r.native ? 'app' : 'browser'}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const rows = [], kept = [];
  for (const r of latest.values()) if (!implausible(r)) { const run = { ...r, tests: rawTests(r) }; kept.push({ run, kind: r.native ? 'app' : 'browser', device: r.device, info: r.info, cats: scoreRun(run).cats }); }
  const odd = outliers(kept);
  for (const [i, { run }] of kept.entries()) {
    if (odd.has(i)) continue;
    const r = run, tests = run.tests, base = scoreRun(run);
    if (!base.system) continue;
    const round = v => v == null ? undefined : Math.round(v * 10) / 10;
    const t = {}; for (const [id, v] of Object.entries(tests)) { const sc = scoreTest(id, v); if (sc != null) t[id] = round(sc); }
    rows.push({ k: r.native ? 'app' : 'browser', f: r.device?.formFactor || (r.native ? 'computer' : 'computer'),
      s: Object.fromEntries(PROFILES.map(p => [p.id, round(scoreRun(run, p).system)])), c: Object.fromEntries(Object.entries(base.cats).map(([k, v]) => [k, round(v)])), t });
  }
  const body = { updated: Date.now(), rows };
  popCache = { until: Date.now() + 5 * 60e3, body };
  return body;
}

// ---------- sign-in lockout (Jordan, 2026-11-14) ----------
// Five wrong passwords lock the email for an hour. Five more after that lock it for a day. Five more
// lock it until a support request is answered (server/admin.mjs unlock). A correct password resets
// the count, and so do 30 days without a wrong one. Emails with no account are locked the same way,
// so the lock does not reveal which emails have accounts.
const GUARD_TRIES = 5, LOCKS = [0, 3600e3, 864e5, Infinity];
const guardOf = idx => q('SELECT * FROM guard WHERE email_idx = ?').get(idx);
function lockedMessage(g) {
  if (g.tier >= 3) return 'This account is locked after too many wrong passwords. Send a support request to unlock it.';
  const mins = Math.ceil((g.locked_until - Date.now()) / 60e3);
  return `Too many wrong passwords. This account is locked for ${mins > 90 ? Math.ceil(mins / 60) + ' hours' : mins + ' minutes'}. ${g.tier === 1 ? 'After the next five wrong tries it locks for a day.' : 'After the next five wrong tries it locks until you send a support request.'}`;
}
function guardCheck(idx) {
  const g = guardOf(idx); if (!g) return;
  if (g.tier >= 3 || g.locked_until > Date.now()) throw new Fail(423, lockedMessage(g));
}
function guardFail(idx) {
  const now = Date.now(); let g = guardOf(idx);
  if (g && g.tier < 3 && now - g.last_fail > 30 * 864e5) g = null;      // a month of quiet starts afresh
  let fails = (g ? g.fails : 0) + 1, tier = g ? g.tier : 0, until = g ? g.locked_until : 0;
  if (fails >= GUARD_TRIES) { tier = Math.min(tier + 1, 3); fails = 0; until = tier >= 3 ? 8.64e15 : now + LOCKS[tier]; }
  q('INSERT INTO guard (email_idx, fails, tier, locked_until, last_fail) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email_idx) DO UPDATE SET fails = excluded.fails, tier = excluded.tier, locked_until = excluded.locked_until, last_fail = excluded.last_fail').run(idx, fails, tier, until, now);
  return { fails, tier, until };
}
const guardReset = idx => q('DELETE FROM guard WHERE email_idx = ?').run(idx);

// ---------- api ----------
async function api(req, res, route) {
  const method = req.method, ip = ipOf(req);
  if (method !== 'GET' && !sameOrigin(req)) throw new Fail(403, 'That request came from another site.');

  if (route === 'challenge' && method === 'GET') { if (!allow('pow:' + ip, 60, 60e3)) throw new Fail(429, 'Too many tries. Wait a minute.'); return send(res, 200, newChallenge()); }

  if (route === 'register' && method === 'POST') {
    const b = await readJson(req, 20e3);
    if (!allow('regtry:' + ip, 30, 3600e3)) throw new Fail(429, 'Too many attempts from this address. Try again in an hour.');
    if (b.website) return send(res, 200, { ok: true });                    // honeypot: a person never fills this in
    if (!checkPow(b.pow)) throw new Fail(400, 'The bot check failed. Try again.');
    const email = cleanEmail(b.email), username = cleanUsername(b.username), pass = await hashPassword(cleanPassword(b.password)), name = username;
    if (q('SELECT 1 FROM users WHERE email_idx = ?').get(emailIdx(email))) throw new Fail(409, 'There is already an account with that email. Sign in instead.');
    if (!usernameFree(username)) throw new Fail(409, 'That username is taken. Try another.');
    if (!allow('reg:' + ip, 5, 3600e3)) throw new Fail(429, 'Too many new accounts from this address. Try again in an hour.');
    const id = q('INSERT INTO users (email_idx, email_enc, name, username, pass, created) VALUES (?, ?, ?, ?, ?, ?)').run(emailIdx(email), sealEmail(email), name, username, pass, Date.now()).lastInsertRowid;
    return send(res, 200, { user: publicUser({ id, email, name, username, created: Date.now() }) }, startSession(res, id));
  }

  if (route === 'login' && method === 'POST') {
    const b = await readJson(req, 20e3), email = String(b.email || '').trim().toLowerCase();
    if (!allow('login:' + ip, 20, 900e3)) throw new Fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    if (!checkPow(b.pow)) throw new Fail(400, 'The bot check failed. Try again.');
    const idx = emailIdx(email);
    guardCheck(idx);
    const u = q('SELECT * FROM users WHERE email_idx = ?').get(idx);
    const ok = await checkPassword(String(b.password || ''), u ? u.pass : DUMMY);
    if (!u || !ok) {
      const g = guardFail(idx);
      if (g.fails === 0) throw new Fail(423, lockedMessage({ ...g, locked_until: g.until }));
      const left = GUARD_TRIES - g.fails;
      throw new Fail(401, `That email and password do not match an account.${left <= 2 ? ` ${left} more wrong ${left === 1 ? 'try' : 'tries'} and it locks${g.tier === 0 ? ' for an hour' : g.tier === 1 ? ' for a day' : ' until you send a support request'}.` : ''}`);
    }
    guardReset(idx);
    console.log(new Date().toISOString(), 'login ok', 'user', u.id, '|', (req.headers['user-agent'] || '').slice(0, 120));
    return send(res, 200, { user: publicUser(u) }, startSession(res, u.id));
  }

  // Upload from the Pressmark app, using a key made on the account page.
  if (route === 'upload' && method === 'POST') {
    const key = /^Bearer (pmk_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '')?.[1];
    if (!allow('upload:' + ip, 120, 3600e3)) throw new Fail(429, 'Too many uploads. Try again later.');
    const k = key && q('SELECT user_id FROM keys WHERE key_hash = ?').get(sha(key));
    if (!k) throw new Fail(401, 'That app key is not valid. Make a new one on your account page.');
    const b = await readJson(req, MAX_RUN_BYTES * 2);
    saveRuns(k.user_id, [b]); q('UPDATE keys SET last_used = ? WHERE key_hash = ?').run(Date.now(), sha(key));
    return send(res, 200, { ok: true });
  }

  // Hand-off from the Pressmark app: it posts a finished run without signing in and opens the site at
  // #claim=TOKEN. The page fetches the run, keeps it in the browser, and saves it to the account when
  // someone is (or later gets) signed in there. Unclaimed hand-offs expire after a day.
  if (route === 'handoff' && method === 'POST') {
    if (!allow('handoff:' + ip, 60, 3600e3)) throw new Fail(429, 'Too many results sent from this address. Try again later.');
    if (q('SELECT COUNT(*) AS n FROM handoffs').get().n > 5000) throw new Fail(503, 'The server is busy. Try again later.');
    const row = cleanRun(await readJson(req, MAX_RUN_BYTES * 2));
    const token = crypto.randomBytes(18).toString('base64url');
    q('INSERT INTO handoffs (token_hash, data, expires) VALUES (?, ?, ?)').run(sha(token), row.data, Date.now() + 864e5);
    return send(res, 200, { token });
  }
  if (route.startsWith('handoff/') && method === 'GET') {
    if (!allow('handoff-get:' + ip, 120, 3600e3)) throw new Fail(429, 'Too many tries. Wait a while.');
    const h = q('SELECT data FROM handoffs WHERE token_hash = ? AND expires > ?').get(sha(route.slice(8)), Date.now());
    if (!h) throw new Fail(404, 'Those results have expired or were never sent. The app also saved them as a file you can load.');
    return send(res, 200, { run: JSON.parse(h.data) });
  }

  // The public leaderboard: every submitted run with its owner's username.
  if (route === 'leaderboard' && method === 'GET') {
    if (!allow('board:' + ip, 120, 60e3)) throw new Fail(429, 'Too many requests. Wait a minute.');
    const me = sessionUser(req);
    if (!boardCache || boardCache.until < Date.now()) {
      const rows = q('SELECT b.user_id, b.data, b.submitted, u.username FROM board b JOIN users u ON u.id = b.user_id WHERE u.username IS NOT NULL ORDER BY b.submitted DESC LIMIT ?').all(BOARD_MAX)
        .map(r => ({ uid: r.user_id, e: { ...JSON.parse(r.data), user: r.username, submitted: r.submitted } }));
      const odd = outliers(rows.map(({ e }) => ({ kind: e.kind, device: e.device, info: e.info, cats: scoring.scoreRun({ ...e, tests: rawTests(e) }).cats })));
      boardCache = { until: Date.now() + 30e3, rows: rows.map((r, i) => ({ ...r, review: odd.has(i) })) };
    }
    // Entries held back as outliers are shown only to their owner, marked as under review.
    return send(res, 200, { entries: boardCache.rows.filter(r => !r.review || (me && me.id === r.uid)).map(r => ({ ...r.e, mine: !!me && me.id === r.uid, review: r.review })) });
  }

  // Support requests (for example, to unlock an account). Stored with the email encrypted; read with
  // server/admin.mjs. No account needed.
  if (route === 'support' && method === 'POST') {
    const b = await readJson(req, 20e3);
    if (!allow('support:' + ip, 5, 3600e3)) throw new Fail(429, 'Too many requests from this address. Try again in an hour.');
    if (b.website) return send(res, 200, { ok: true });
    if (!checkPow(b.pow)) throw new Fail(400, 'The bot check failed. Try again.');
    const email = cleanEmail(b.email), kind = ['unlock', 'other'].includes(b.kind) ? b.kind : 'other', message = String(b.message || '').trim().slice(0, 4000);
    if (kind === 'other' && message.length < 10) throw new Fail(400, 'Tell us a little more about what you need.');
    if (q('SELECT COUNT(*) AS n FROM support WHERE status = ?').get('open').n > 2000) throw new Fail(503, 'Too many open requests. Try again later.');
    q('INSERT INTO support (created, email_enc, email_idx, kind, message) VALUES (?, ?, ?, ?, ?)').run(Date.now(), sealEmail(email), emailIdx(email), kind, message);
    console.log(new Date().toISOString(), 'support request', kind);
    return send(res, 200, { ok: true });
  }

  // Everyone's scores, anonymously, for the percentile view: one row per machine (the latest run of each
  // device in each account), with no user, device name or hardware, just the kind of test, the kind of
  // device and the scores.
  if (route === 'population' && method === 'GET') {
    if (!allow('pop:' + ip, 60, 60e3)) throw new Fail(429, 'Too many requests. Wait a minute.');
    return send(res, 200, await population());
  }

  const user = sessionUser(req);
  if (route === 'me' && method === 'GET') return send(res, 200, { user: user ? publicUser(user) : null });
  if (!user) throw new Fail(401, 'Sign in first.');

  if (route === 'logout' && method === 'POST') {
    const m = /(?:^|;\s*)pm_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || ''); if (m) q('DELETE FROM sessions WHERE token_hash = ?').run(sha(m[1]));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (route === 'runs' && method === 'GET') return send(res, 200, { runs: q('SELECT data FROM runs WHERE user_id = ? ORDER BY time DESC').all(user.id).map(r => JSON.parse(r.data)) });
  if (route === 'runs' && method === 'PUT') { const b = await readJson(req, 6e6); if (!Array.isArray(b.runs) || b.runs.length > 200) throw new Fail(400, 'Send up to 200 runs at a time.'); return send(res, 200, { saved: saveRuns(user.id, b.runs) }); }
  if (route === 'runs/delete' && method === 'POST') {
    const b = await readJson(req, 100e3); if (!Array.isArray(b.ids)) throw new Fail(400, 'Send a list of run ids.');
    const del = q('DELETE FROM runs WHERE user_id = ? AND id = ?'); let n = 0; for (const id of b.ids.slice(0, 2000)) n += del.run(user.id, String(id)).changes;
    return send(res, 200, { deleted: n });
  }
  if (route === 'username' && method === 'POST') {
    const b = await readJson(req, 5e3), username = cleanUsername(b.username);
    if (!allow('uname:' + user.id, 10, 3600e3)) throw new Fail(429, 'Too many changes. Try again in an hour.');
    if (!usernameFree(username, user.id)) throw new Fail(409, 'That username is taken. Try another.');
    q('UPDATE users SET username = ?, name = ? WHERE id = ?').run(username, username, user.id);
    return send(res, 200, { user: publicUser({ ...user, username, name: username }) });
  }
  if (route === 'leaderboard' && method === 'POST') {
    if (!user.username) throw new Fail(409, 'Choose a username on your account page first. It is what the leaderboard shows.');
    const b = await readJson(req, MAX_RUN_BYTES * 2), e = boardEntry(b.run), why = implausible(e);
    if (why) throw new Fail(422, `These results cannot go on the leaderboard: ${why}.`);
    if (q('SELECT COUNT(*) AS n FROM board WHERE user_id = ?').get(user.id).n >= BOARD_PER_USER && !q('SELECT 1 FROM board WHERE user_id = ? AND run_id = ?').get(user.id, e.id)) throw new Fail(409, `You have ${BOARD_PER_USER} runs on the leaderboard. Remove one first.`);
    q('INSERT INTO board (user_id, run_id, kind, submitted, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, run_id) DO UPDATE SET data = excluded.data').run(user.id, e.id, e.kind, Date.now(), JSON.stringify(e));
    boardCache = null;
    return send(res, 200, { ok: true });
  }
  if (route === 'leaderboard/delete' && method === 'POST') { const b = await readJson(req, 5e3); boardCache = null; return send(res, 200, { deleted: q('DELETE FROM board WHERE user_id = ? AND run_id = ?').run(user.id, String(b.id || '')).changes }); }
  if (route === 'keys' && method === 'GET') return send(res, 200, { keys: q('SELECT substr(key_hash, 1, 12) AS id, label, created, last_used FROM keys WHERE user_id = ? ORDER BY created DESC').all(user.id) });
  if (route === 'keys' && method === 'POST') {
    const b = await readJson(req, 5e3);
    if (q('SELECT COUNT(*) AS n FROM keys WHERE user_id = ?').get(user.id).n >= 20) throw new Fail(409, 'You have 20 app keys already. Remove one first.');
    const key = 'pmk_' + crypto.randomBytes(24).toString('base64url');
    q('INSERT INTO keys (key_hash, user_id, label, created) VALUES (?, ?, ?, ?)').run(sha(key), user.id, String(b.label || 'Computer test').slice(0, 60), Date.now());
    return send(res, 200, { key });                                         // shown once; only its hash is kept
  }
  if (route === 'keys/delete' && method === 'POST') { const b = await readJson(req, 5e3); q('DELETE FROM keys WHERE user_id = ? AND substr(key_hash, 1, 12) = ?').run(user.id, String(b.id || '')); return send(res, 200, { ok: true }); }
  if (route === 'password' && method === 'POST') {
    const b = await readJson(req, 20e3);
    if (!allow('pw:' + user.id, 8, 900e3)) throw new Fail(429, 'Too many attempts. Wait 15 minutes.');
    const u = q('SELECT pass FROM users WHERE id = ?').get(user.id);
    if (!await checkPassword(String(b.current || ''), u.pass)) throw new Fail(401, 'Your current password is not right.');
    q('UPDATE users SET pass = ? WHERE id = ?').run(await hashPassword(cleanPassword(b.next)), user.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(user.id);               // sign out everywhere, then back in here
    return send(res, 200, { ok: true }, startSession(res, user.id));
  }
  if (route === 'account/delete' && method === 'POST') {
    const b = await readJson(req, 20e3), u = q('SELECT pass FROM users WHERE id = ?').get(user.id);
    if (!await checkPassword(String(b.password || ''), u.pass)) throw new Fail(401, 'That password is not right.');
    q('DELETE FROM users WHERE id = ?').run(user.id);                       // runs, keys and sessions go with it
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  throw new Fail(404, 'No such address.');
}

// ---------- static site ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.exe': 'application/octet-stream', '': 'application/octet-stream' };
const ALLOWED = /^\/(index\.html|style\.css|app\.js|charts\.js|scoring\.js|icon\.svg|manifest\.webmanifest|tests\/[\w.-]+\.js|downloads\/[\w.-]+)$/;
function serveFile(req, res, urlPath) {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  if (!ALLOWED.test(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const file = path.join(SITE, p);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    // Cloudflare keeps copies of everything but the page itself for a few minutes, so a rush of visitors
    // mostly never reaches the home server.
    // Browsers check every time (so a deploy never leaves them with a mix of old and new files);
    // only Cloudflare's edge keeps copies, for five minutes (s-maxage).
    const cache = p === '/index.html' ? 'no-cache' : p.startsWith('/downloads/') ? 'public, max-age=3600' : 'public, max-age=0, s-maxage=300, must-revalidate';
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache, ...SECURITY }); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, ETag: etag,
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', ...SECURITY,
      ...(p.startsWith('/downloads/') ? { 'Content-Disposition': 'attachment' } : {}) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = '/';
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch {}
  if (urlPath.startsWith('/api/')) {
    try { await api(req, res, urlPath.slice(5).replace(/\/$/, '')); }
    catch (e) { if (!res.headersSent) send(res, e instanceof Fail ? e.code : 500, { error: e instanceof Fail ? e.message : 'Something went wrong on the server.' }); if (!(e instanceof Fail)) console.error(new Date().toISOString(), req.method, urlPath, e); else if (/^\/api\/(login|register|challenge)/.test(urlPath)) console.log(new Date().toISOString(), req.method, urlPath, e.code, e.message, '|', (req.headers['user-agent'] || '').slice(0, 120)); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY); return res.end(); }
  serveFile(req, res, urlPath);
});
server.requestTimeout = 20e3; server.headersTimeout = 10e3;            // slow clients cannot hold connections open
server.listen(PORT, HOST, () => console.log(`1000Mark server on http://${HOST}:${PORT}  site=${SITE}  data=${DATA}`));
