import { SUITE, CATS, TESTS, REF_DEVICE, PROFILES, scoreRun, scoreTest, ramGB } from './scoring.js?v=dev';
import { bars, radar, columns, lanes, esc, fmt, pts } from './charts.js?v=dev';
import { runGpu, gpuOnce, glRenderer } from './tests/gpu.js?v=dev';
import { runMedia } from './tests/media.js?v=dev';

const app = document.getElementById('app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const KEEP = 400;                                    // runs kept on this device
// Where the app downloads live, for pages served by the app itself (localhost).
const SITE_URL = 'https://1000mark.com';
const REPO = 'https://github.com/jordanneenan/1000mark';
const siteUrl = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? SITE_URL : location.origin;
// Runs from before suite 1 used other tests and cannot be compared, so they are set aside (not deleted).
const isCurrent = r => r && r.suite === SUITE;
{ const all = store.get('pressmark.runs', []), old = all.filter(r => !isCurrent(r));
  if (old.length) { store.set('pressmark.runs.pre1', [...store.get('pressmark.runs.pre1', []), ...old]); store.set('pressmark.runs', all.filter(isCurrent)); } }
const state = { runs: store.get('pressmark.runs', []).map(normalise), old: store.get('pressmark.runs.pre1', []).length, showBrowser: store.get('pressmark.showBrowser', false), dev: null, cols: store.get('pressmark.cols', null), marks: store.get('pressmark.marks', { best: true, worst: true }), stat: store.get('pressmark.stat', 'latest'), pick: null, cmp: null, running: null, abort: false, device: null,
  label: store.get('pressmark.label', ''), unit: store.get('pressmark.unit', 'points'), vs: store.get('pressmark.vs', 'auto'), profile: store.get('pressmark.profile', 'general'), theme: store.get('pressmark.theme', null) };
const msg = e => String(e && e.message || e);

// ---------- account (only when the site is served by the 1000Mark server) ----------
const acct = { on: false, user: null, note: '', busy: '', keys: [], newKey: '', board: new Set() };
const lb = { entries: null, error: '', kind: 'app', rank: 'general', dedupe: true, loading: false };
async function api(path, method = 'GET', body) {
  const r = await fetch('api/' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server said no (${r.status}).`);
  return j;
}
// The bot check: the server sets a small puzzle that takes a browser a second or two and a bot farm real money.
async function solvePuzzle() {
  const c = await api('challenge'), enc = new TextEncoder();
  const want = Uint8Array.from(c.challenge.match(/../g).map(h => parseInt(h, 16)));
  for (let n = 0; n <= c.max; n++) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(c.salt + n)));
    if (h[0] === want[0] && h[1] === want[1] && h.every((v, i) => v === want[i])) return { ...c, number: n };
  }
  throw new Error('The bot check could not be completed. Try again.');
}
const pushRuns = async runs => { if (!acct.user || !runs.length) return; try { for (let i = 0; i < runs.length; i += 100) await api('runs', 'PUT', { runs: runs.slice(i, i + 100) }); } catch (e) { acct.note = `Not saved to your account: ${msg(e)}`; render(); } };
const dropRuns = async ids => { if (!acct.user || !ids.length) return; try { await api('runs/delete', 'POST', { ids }); } catch (e) { acct.note = `Not removed from your account: ${msg(e)}`; render(); } };
// After signing in: take the account's runs, and add any made on this browser that the account lacks.
async function pullAccount() {
  const got = (await api('runs')).runs, runs = got.filter(isCurrent); runs.forEach(normalise); state.old = Math.max(state.old, got.length - runs.length);
  const have = new Set(runs.map(r => r.id)), fresh = state.runs.filter(r => !have.has(r.id));
  state.runs = [...runs, ...fresh]; save();
  if (fresh.length) { await pushRuns(fresh); acct.note = `${fresh.length} run${fresh.length > 1 ? 's' : ''} from this browser ${fresh.length > 1 ? 'were' : 'was'} added to your account.`; }
  acct.keys = (await api('keys')).keys;
  await loadBoard();
}
// The public leaderboard. Also tells the results page which of your runs are on it.
async function loadBoard() {
  lb.loading = true;
  try { const { entries, badges } = await api('leaderboard'); lb.entries = entries.filter(isCurrent).map(normalise); lb.badges = badges || {}; lb.error = ''; acct.board = new Set(entries.filter(e => e.mine).map(e => e.id)); }
  catch (e) { lb.error = msg(e); }
  lb.loading = false;
}

const catOf = id => CATS.find(c => c.id === id);
const profile = () => PROFILES.find(p => p.id === state.profile) || PROFILES[0];
const score = r => scoreRun(r, profile());
const save = () => store.set('pressmark.runs', state.runs);

// Runs are grouped into devices by name, with app runs and browser runs kept apart
// because they are different tests.
const STATS = [{ id: 'latest', name: 'Latest run' }, { id: 'avg', name: 'Average' }, { id: 'best', name: 'Best' }, { id: 'low', name: 'Lowest' }];
const groupKey = r => `${r.label || 'Unnamed device'}|${r.native ? 'app' : 'browser'}`;
// A browser test measures the computer through that browser, so browser runs stay out of the way
// unless they are all there is, or the person switches them on.
const hasApp = () => state.runs.some(r => r.native), hasBrowser = () => state.runs.some(r => !r.native);
const browserOn = () => state.showBrowser || !hasApp();
const browserToggle = () => hasApp() && hasBrowser() ? `<label class="chk"><input type="checkbox" id="show-browser" ${state.showBrowser ? 'checked' : ''}> Show browser tests</label>` : '';
function groups() {
  const m = new Map(), on = browserOn();
  for (const r of state.runs.filter(r => r.native || on).sort((a, b) => b.time.localeCompare(a.time))) {
    const key = groupKey(r);
    if (!m.has(key)) m.set(key, { key, label: r.label || 'Unnamed device', kind: r.native ? 'app' : 'browser', runs: [] });
    m.get(key).runs.push(r);
  }
  return [...m.values()];
}
// One "run" standing for a whole device: each test's average, best or lowest across its runs.
function aggregate(g, stat) {
  if (!g) return null;
  const latest = g.runs[0];
  if (stat === 'latest' || g.runs.length === 1) return latest;
  const tests = {};
  for (const id of new Set(g.runs.flatMap(r => Object.keys(r.tests)))) {
    const vs = g.runs.map(r => r.tests[id]).filter(v => v > 0); if (!vs.length) continue;
    tests[id] = stat === 'avg' ? vs.reduce((a, b) => a + b, 0) / vs.length : stat === 'best' ? Math.max(...vs) : Math.min(...vs);
  }
  return { ...latest, id: 'agg:' + g.key, tests, errors: {}, agg: { stat, n: g.runs.length } };
}
// Devices are named; one device can have app runs and browser runs (different tests, same scale).
function deviceList() {
  const m = new Map();
  for (const g of groups()) { if (!m.has(g.label)) m.set(g.label, { label: g.label, sets: [] }); m.get(g.label).sets.push(g); }
  return [...m.values()];
}
const kindName = k => k === 'app' ? 'Computer test' : 'Browser test';
const curGroup = () => { const gs = groups(); return gs.find(g => g.key === state.dev) || gs[0] || null; };
const selRun = () => { const g = curGroup(); if (!g) return null; return (state.pick && g.runs.find(r => r.id === state.pick)) || aggregate(g, state.stat); };
const cmpRun = () => { const g = groups().find(x => x.key === state.cmp), cur = curGroup(); return g && cur && g.key !== cur.key ? aggregate(g, state.stat) : null; };
const describe = r => r.agg ? `${STATS.find(x => x.id === r.agg.stat).name.toLowerCase()} of ${r.agg.n} runs` : when(r.time);
const cmpText = c => c ? `${c.label} (${c.native ? 'computer' : 'browser'} test), ${describe(c)}` : '';

// ---------- badges: who holds first place, worked out by the server (see computeBadges in server.mjs) ----------
// Champion: the highest system score. Gold: the highest score in a use case or a part. Silver: the
// highest in a group of tests inside a part. Bronze: a system score in the top 10%. Computer tests only.
// Each tier has its own shape or texture as well as its colour, so they read in print and for colour blindness.
const TIER = {
  champion: { name: 'Champion', rule: 'The highest system score on the leaderboard. Only one person holds it.' },
  gold: { name: 'Gold', rule: 'The highest score in a use case (gaming, AI, video …) or a part (CPU speed, GPU speed …).' },
  silver: { name: 'Silver', rule: 'The highest score in a group of tests inside a part, such as CPU one core or GPU ray tracing.' },
  bronze: { name: 'Bronze', rule: 'A system score in the top 10% of everyone on the leaderboard.' },
};
const TIER_ORDER = Object.keys(TIER);
// One set of patterns for every badge on the page: hatching for silver, a dot screen for bronze and the halo.
const BADGE_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <pattern id="bd-hatch" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.1" height="3.2" class="bd-tex"/></pattern>
  <pattern id="bd-dots" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".75" class="bd-tex"/></pattern>
  <pattern id="bd-halo" width="2.6" height="2.6" patternUnits="userSpaceOnUse"><circle cx="1.3" cy="1.3" r=".8" class="bd-halo-dot"/></pattern></defs></svg>`;
const BURST = (() => { const p = []; for (let i = 0; i < 24; i++) { const r = i % 2 ? 9.2 : 12.6, a = -Math.PI / 2 + i * Math.PI / 12; p.push(`${(16 + Math.cos(a) * r).toFixed(2)},${(16 + Math.sin(a) * r).toFixed(2)}`); } return p.join(' '); })();
const STAR = (() => { const p = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.2 : 5, a = -Math.PI / 2 + i * Math.PI / 5; p.push(`${(16 + Math.cos(a) * r).toFixed(2)},${(16 + Math.sin(a) * r).toFixed(2)}`); } return p.join(' '); })();
const OCT = '9,11 17,11 22,16 22,24 17,29 9,29 4,24 4,16';
function medal(tier) {
  if (tier === 'champion') return `<svg class="bd-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="15.5" fill="url(#bd-halo)" class="bd-halo"/>
    <g class="bd-spin"><polygon points="${BURST}" class="bd-shadow" transform="translate(1.6 1.6)"/><polygon points="${BURST}" class="bd-face"/></g>
    <polygon points="${STAR}" class="bd-star"/></svg>`;
  const tex = tier === 'silver' ? 'url(#bd-hatch)' : tier === 'bronze' ? 'url(#bd-dots)' : '';
  return `<svg class="bd-svg" viewBox="0 0 26 32" aria-hidden="true" focusable="false">
    <polygon points="5,0 10.5,0 13.5,11 8,11" class="bd-strap a"/><polygon points="15.5,0 21,0 18,11 12.5,11" class="bd-strap b"/>
    <polygon points="${OCT}" class="bd-shadow" transform="translate(1.6 1.6)"/><polygon points="${OCT}" class="bd-face"/>
    ${tex ? `<polygon points="${OCT}" fill="${tex}"/>` : '<polygon points="10,14 16,14 19,17" class="bd-shine"/>'}</svg>`;
}
const heldFor = since => {
  const h = (Date.now() - since) / 36e5, n = (v, u) => `${v} ${u}${v === 1 ? '' : 's'}`;
  return h < 1 ? 'less than an hour' : h < 48 ? n(Math.floor(h), 'hour') : h < 24 * 14 ? n(Math.floor(h / 24), 'day') : h < 24 * 60 ? n(Math.floor(h / 168), 'week') : n(Math.floor(h / 730), 'month');
};
let tips = [];
// A username's best badge: one mark only. Hovering or focusing it shows the card, which lists the
// badges of that tier and counts the rest (the account page lists them all).
function badgesFor(user, { focus = true } = {}) {
  const list = (lb.badges || {})[user]; if (!list || !list.length) return '';
  const t = TIER_ORDER.find(x => list.some(b => b.tier === x)), items = list.filter(b => b.tier === t);
  const rest = TIER_ORDER.filter(x => x !== t).map(x => [x, list.filter(b => b.tier === x).length]).filter(([, n]) => n);
  tips.push({ user, tier: t, items, rest });
  const label = `${TIER[t].name} badge: ${items.map(b => b.title.replace(/^[^·]*· /, '')).join(', ')}${rest.length ? `; also ${rest.map(([x, n]) => `${n} ${TIER[x].name.toLowerCase()}`).join(', ')}` : ''}`;
  return `<span class="badges"><span class="badge t-${t}" data-tip="${tips.length - 1}" role="img" aria-label="${esc(label)}" ${focus ? 'tabindex="0"' : ''}>${medal(t)}</span></span>`;
}
function tipCard(tip) {
  const date = since => new Date(since).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<div class="bd-tip-head"><span class="badge t-${tip.tier}">${medal(tip.tier)}</span><div><b>${esc(TIER[tip.tier].name)}${tip.items.length > 1 ? ` × ${tip.items.length}` : ''}</b><small>${esc(tip.user)}</small></div></div>
    ${tip.items.map(b => `<div class="bd-tip-row"><b>${esc(b.title)}</b><span>${esc(b.why)}</span><small>Held for ${heldFor(b.since)} · since ${date(b.since)}</small></div>`).join('')}
    ${tip.rest.length ? `<div class="bd-tip-rest">Also holds ${tip.rest.map(([x, n]) => `<span><span class="badge t-${x}">${medal(x)}</span>${n} ${TIER[x].name.toLowerCase()}</span>`).join('')}</div>` : ''}`;
}
const tipBox = document.createElement('div'); tipBox.className = 'bd-tip'; tipBox.id = 'bd-tip'; tipBox.setAttribute('role', 'tooltip'); tipBox.hidden = true;
document.body.append(tipBox); document.body.insertAdjacentHTML('beforeend', BADGE_DEFS);
let tipAnchor = null;
function showTip(el) {
  const t = tips[+el.dataset.tip]; if (!t) return;
  tipAnchor = el;
  tipBox.innerHTML = tipCard(t); tipBox.hidden = false; el.setAttribute('aria-describedby', 'bd-tip');
  const r = el.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight, gap = 10;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const top = r.top - h - gap > 8 ? r.top - h - gap : Math.min(innerHeight - h - 8, r.bottom + gap);
  tipBox.style.left = `${left}px`; tipBox.style.top = `${top}px`;
}
const hideTip = () => { tipBox.hidden = true; tipAnchor = null; };
document.addEventListener('mouseover', e => { const b = e.target.closest('.badge[data-tip]'); if (b) showTip(b); else if (!e.target.closest('.bd-tip')) hideTip(); });
document.addEventListener('focusin', e => { const b = e.target.closest('.badge[data-tip]'); if (b) showTip(b); else hideTip(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
// Scrolling (including the scroll that focusing a badge causes) moves the card with its badge.
addEventListener('scroll', () => { if (!tipAnchor) return; const r = tipAnchor.getBoundingClientRect(); if (!tipAnchor.isConnected || r.bottom < 0 || r.top > innerHeight) hideTip(); else showTip(tipAnchor); }, { passive: true });
// The rules, with a mark for each tier: on the leaderboard and the account page.
const badgeRules = () => `<div class="bd-rules">${TIER_ORDER.map(t => `<div class="bd-rule"><span class="badge t-${t} big">${medal(t)}</span><div><b>${TIER[t].name}</b><span>${esc(TIER[t].rule)}</span></div></div>`).join('')}</div>`;

// ---------- percentile: how a score sits among everyone's machines ----------
// The server sends one anonymous row of scores per machine (/api/population). A percentile compares
// against the same kind of test (computer or browser) and the chosen kind of device.
let pop = null;
const loadPop = async () => { try { pop = await api('population'); } catch { pop = null; } };
const VS = [{ id: 'auto', name: 'Devices like this one' }, { id: 'all', name: 'All devices' }, { id: 'computer', name: 'Computers' }, { id: 'desktop', name: 'Desktops' }, { id: 'laptop', name: 'Laptops' }, { id: 'mobile', name: 'Phones and tablets' }];
const isMobileFF = f => f === 'phone' || f === 'tablet';
const vsOf = run => state.vs !== 'auto' ? state.vs : isMobileFF(run.device && run.device.formFactor) ? 'mobile' : 'computer';
const vsName = run => ({ all: 'all devices', computer: 'computers', desktop: 'desktops', laptop: 'laptops', mobile: 'phones and tablets' })[vsOf(run)];
const matchVs = (f, vs) => vs === 'all' || (vs === 'mobile' ? isMobileFF(f) : vs === 'computer' ? !isMobileFF(f) : f === vs);
const pctOn = () => state.unit === 'pct' && pop && acct.on;
function peers(run) {
  if (!pop) return [];
  const k = run.native ? 'app' : 'browser', vs = vsOf(run);
  return pop.rows.filter(r => r.k === k && matchVs(r.f || 'computer', vs));
}
// metric: ['s', profileId] system score, ['c', partId] part score, ['t', testId] test points.
function pctile(run, metric, v) {
  if (!(v > 0)) return null;
  const vals = peers(run).map(r => r[metric[0]] && r[metric[0]][metric[1]]).filter(x => x > 0);
  if (!vals.length) return null;
  let below = 0, eq = 0; for (const x of vals) { if (x < v - 0.05) below++; else if (Math.abs(x - v) <= 0.05) eq++; }
  return 100 * (below + eq / 2) / vals.length;
}
const pc = v => v == null ? '–' : `${Math.round(v)}%`;
function unitBar(run) {
  if (!acct.on) return '';
  const n = peers(run).length, opt = (v, t) => `<option value="${v}" ${v === state.vs ? 'selected' : ''}>${esc(t)}</option>`;
  return `<section class="unit-bar">
    <div class="seg" role="group" aria-label="Show scores as"><button class="${state.unit !== 'pct' ? 'on' : ''}" data-act="unit" data-id="points" aria-pressed="${state.unit !== 'pct'}">Points</button><button class="${state.unit === 'pct' ? 'on' : ''}" data-act="unit" data-id="pct" aria-pressed="${state.unit === 'pct'}">Percentile</button></div>
    ${state.unit === 'pct' ? `<label>Compared with <select id="c-vs">${VS.map(x => opt(x.id, x.id === 'auto' ? `${x.name} (${vsName({ ...run, device: run.device })})` : x.name)).join('')}</select></label>
      <span class="unit-note">${!pop ? 'Everyone\'s scores could not be loaded.' : n ? `${n} machine${n > 1 ? 's' : ''} so far, ${run.native ? 'computer' : 'browser'} tests only. 50% is the middle; higher is faster.` : `No ${vsName(run)} have been tested with this test yet.`}</span>` : '<span class="unit-note">1000 points = the reference desktop. Switch to percentile to see where this sits among everyone else\'s machines.</span>'}
  </section>`;
}

function applyTheme() { if (state.theme) document.documentElement.dataset.theme = state.theme; else delete document.documentElement.dataset.theme; }
const isDark = () => state.theme ? state.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const when = iso => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The native app saves raw per-second rates; convert them once to the display units the scoring uses.
function normalise(r) {
  if (r.native && !r.norm) { for (const id of Object.keys(r.tests)) if (TESTS[id] && TESTS[id].div) r.tests[id] /= TESTS[id].div; r.norm = true; }
  return r;
}

// ---------- device ----------
async function detect() {
  const d = { cores: navigator.hardwareConcurrency || 1, memory: navigator.deviceMemory || null, screen: `${screen.width} × ${screen.height} at ${+devicePixelRatio.toFixed(2)}x`, gpu: glRenderer(), os: '', browser: '', arch: '', model: '', secure: isSecureContext, webgpu: !!navigator.gpu, webcodecs: typeof VideoEncoder !== 'undefined' };
  const u = navigator.userAgentData, ua = navigator.userAgent;
  if (u) {
    try { const h = await u.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness', 'model']); d.os = [h.platform, h.platformVersion].filter(Boolean).join(' '); d.arch = [h.architecture, h.bitness && h.bitness + '-bit'].filter(Boolean).join(' '); d.model = h.model || ''; } catch {}
    const b = (u.brands || []).filter(x => !/not.?a.?brand/i.test(x.brand)); const pick = b.find(x => !/chromium/i.test(x.brand)) || b[0];
    if (pick) d.browser = pick.brand + ' ' + pick.version;
  }
  if (!d.os) d.os = /Windows NT/.test(ua) ? 'Windows' : /Android ([\d.]+)/.test(ua) ? 'Android ' + RegExp.$1 : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS') : /Linux/.test(ua) ? 'Linux' : 'Unknown system';
  // Phone, tablet, laptop or desktop. A browser can tell phones and tablets apart from computers; a computer
  // with a battery that is discharging or not full is a laptop. Otherwise it stays 'computer' (laptop or desktop).
  const mobile = u ? u.mobile : /Mobi|iPhone|iPod/.test(ua);
  const tablet = d.os === 'iPadOS' || /iPad/.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua));
  d.formFactor = mobile ? 'phone' : tablet ? 'tablet' : 'computer';
  if (d.formFactor === 'computer' && navigator.getBattery) {
    try { const bt = await Promise.race([navigator.getBattery(), new Promise((_, no) => setTimeout(no, 500))]); if (!bt.charging || bt.level < 1) d.formFactor = 'laptop'; } catch {}
  }
  if (!d.browser) d.browser = /Firefox\/(\d+)/.test(ua) ? 'Firefox ' + RegExp.$1 : /Edg\/(\d+)/.test(ua) ? 'Edge ' + RegExp.$1 : /Chrome\/(\d+)/.test(ua) ? 'Chrome ' + RegExp.$1 : /Version\/(\d+).*Safari/.test(ua) ? 'Safari ' + RegExp.$1 : 'Unknown browser';
  return d;
}

// ---------- running ----------
let seq = 0;
function call(w, data, onProgress) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = e => { if (e.data.id !== id) return; if (e.data.progress) { onProgress && onProgress(e.data.progress); return; } cleanup(); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
    const onErr = e => { cleanup(); rej(new Error(e.message || 'The test crashed')); };
    const cleanup = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
    w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
    w.postMessage({ ...data, id });
  });
}
const worker = name => new Worker(new URL(`./tests/${name}.worker.js?v=dev`, import.meta.url));

// Every test is timed three times for MS and the middle result kept, so one hiccup cannot move it.
const MS = 700, median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const CPU_TESTS = ['zip', 'json', 'script', 'path', 'db', 'image', 'ray', 'physics', 'matrix', 'sort', 'crypto'];
// One timing on some workers at once: their summed rate.
const round = async (ws, ms) => (await Promise.all(ws.map(w => call(w, { cmd: 'time', ms })))).reduce((a, r) => a + r.rate, 0);
async function measure(ws, test, bytes) {
  await Promise.all(ws.map(w => call(w, { cmd: 'prep', test, bytes })));
  const v = []; for (let i = 0; i < 3; i++) v.push(await round(ws, MS));
  return median(v);
}

// Heat. Scores come from short bursts on a cool device. This times a few CPU and GPU tests again at
// the end and reports the share of their speed that is left. With `minutes` it first loads every
// core and the graphics chip for that long, sampling the speed as it goes. Scores never change.
const HEAT_CPU = ['zip', 'physics', 'matrix'], HEAT_GPU = ['gpu_scene', 'gpu_rays'], SOAK = 12;
async function heatTest(rec, ws, minutes, say, started) {
  const series = [], gpu = rec.info.gpuApi === 'WebGPU';
  if (minutes) {
    await Promise.all(ws.map(w => call(w, { cmd: 'prep', test: 'matrix' })));
    const t0 = performance.now(); let c0 = 0, g0 = 0;
    while (performance.now() - t0 < minutes * 60000 && !state.abort) {
      const [c, g] = await Promise.all([round(ws, 4000), gpu ? gpuOnce(['gpu_scene'], 4000).then(o => o.gpu_scene) : null]);
      if (!c0) { c0 = c; g0 = g || 0; }
      const el = Math.round((performance.now() - t0) / 1000), cr = c / c0, gr = g && g0 ? g / g0 : null;
      series.push([el, +cr.toFixed(3), gr && +gr.toFixed(3)]);
      say(`Heat test · ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')} of ${minutes}:00 · CPU at ${Math.round(cr * 100)}%${gr ? `, GPU at ${Math.round(gr * 100)}%` : ''}`);
    }
  }
  say('Heat · measuring again');
  const geo = v => v.length ? +Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length).toFixed(3) : null, cr = [];
  for (const t of HEAT_CPU) { const cold = rec.tests['ca_' + t]; if (!cold) continue; await Promise.all(ws.map(w => call(w, { cmd: 'prep', test: t }))); cr.push(await round(ws, MS) / TESTS['ca_' + t].div / cold); }
  const hot = gpu ? await gpuOnce(HEAT_GPU, MS, 3) : {};      // three timings, as when cool: the first also wakes the chip up
  return { mode: minutes ? 'soak' : 'end', soak: minutes || null, minutes: +((performance.now() - started) / 60000).toFixed(1), cpu: geo(cr), gpu: geo(HEAT_GPU.filter(id => hot[id] && rec.tests[id]).map(id => hot[id] / rec.tests[id])), series };
}

function buildSteps(rec, workers, soak) {
  const quick = false, steps = [], started = performance.now();
  const put = (id, raw) => { rec.tests[id] = raw / (TESTS[id].div || 1); };
  const pool = [], pooled = n => { while (pool.length < n) pool.push(workers.add(worker('cpu'))); return pool.slice(0, n); };
  // One core, six threads (about as many as a game or a busy app keeps working), then every thread.
  const cores = state.device.cores, six = Math.min(6, cores);
  for (const [pre, n, what] of [['c1', 1, 'one core'], ['c6', six, `${six} threads`], ['ca', cores, `all ${cores} threads`]])
    for (const t of CPU_TESTS) { const id = `${pre}_${t}`; steps.push({ id, cat: 'cpu', label: `CPU · ${TESTS[id].name.toLowerCase()} · ${what}`, run: async () => put(id, await measure(pooled(n), t)) }); }
  const bytes = (state.device.memory && state.device.memory <= 2 ? 32 : 64) * 1048576;
  for (const t of ['fill', 'read', 'copy', 'chase', 'alloc'])
    // Random jumps need a table bigger than any processor cache (128 MB, as in the computer test).
    steps.push({ id: 'm_' + t, cat: 'memory', label: `Memory · ${TESTS['m_' + t].name.toLowerCase()}`, run: async () => { put('m_' + t, await measure(pooled(1), t, t === 'chase' ? bytes * 4 : bytes)); rec.info.memBlock = bytes; } });
  const per = Math.max(4, Math.min(16, Math.floor(256 / cores))) * 1048576;
  steps.push({ id: 'm_copy_all', cat: 'memory', label: `Memory · copy on all ${cores} threads`, run: async () => { put('m_copy_all', await measure(pooled(cores), 'copy', per)); await Promise.all(pooled(cores).map(w => call(w, { cmd: 'free' }))); } });
  steps.push({ id: 'storage', cat: 'storage-speed', label: 'Storage', run: async (sub) => {
    const w = workers.add(worker('storage')); const r = await call(w, { quick }, sub);
    Object.assign(rec.tests, r.values); Object.assign(rec.errors, r.errors);
    rec.info.fileBytes = r.fileBytes; } });
  steps.push({ id: 'gpu', cat: 'gpu', label: 'GPU', run: async (sub) => {
    const r = await runGpu({ ms: MS, progress: sub }); Object.assign(rec.tests, r.values); Object.assign(rec.errors, r.errors);
    rec.info.gpuApi = r.api; rec.info.gpuAdapter = r.adapter; } });
  steps.push({ id: 'video', cat: 'gpu', label: 'Video', run: async (sub) => {
    const r = await runMedia({ quick, progress: sub }); Object.assign(rec.tests, r.values); Object.assign(rec.errors, r.errors); rec.info.codecs = r.codecs; } });
  steps.push({ id: 'heat', cat: 'cpu', label: soak ? `Heat test · ${soak} minutes at full load` : 'Heat · measuring again', run: async (sub) => { rec.heat = await heatTest(rec, pooled(cores), soak, sub, started); } });
  return steps;
}

async function run(soak = 0) {
  if (state.running) return;
  const rec = { id: Date.now().toString(36), suite: SUITE, time: new Date().toISOString(), mode: 'full', label: state.label || state.device.model || state.device.os, device: state.device, tests: {}, errors: {}, info: {} };
  const list = new Set(); const workers = { add: w => (list.add(w), w) };
  const steps = buildSteps(rec, workers, soak);
  state.abort = false;
  state.running = { steps: steps.map(s => ({ label: s.label, cat: s.cat, st: 'todo' })), now: 'Starting', soak };
  location.hash = ''; render();
  let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch {}       // keep a phone's screen on
  for (let i = 0; i < steps.length && !state.abort; i++) {
    const s = steps[i], view = state.running.steps[i];
    view.st = 'doing'; state.running.now = s.label; render();
    try { await s.run(label => { state.running.now = label; const el = document.getElementById('now'); if (el) el.textContent = label; }); view.st = 'done'; }
    catch (e) { rec.errors[s.id] = msg(e); view.st = 'fail'; }
    await new Promise(r => setTimeout(r, 30));          // let the page breathe (and the CPU settle) between tests
  }
  for (const w of list) w.terminate();
  if (lock) lock.release().catch(() => {});
  if (!state.abort) {
    state.runs.unshift(rec); state.runs = state.runs.slice(0, KEEP); save();
    if (hasApp() && !state.showBrowser) { state.showBrowser = true; store.set('pressmark.showBrowser', true); }   // they asked for a browser test, so show it
    state.dev = groupKey(rec); state.pick = null; pushRuns([rec]);
  }
  state.running = null; location.hash = 'home'; render(); window.scrollTo(0, 0);
}

// The computer test has no video test of its own: video encoders are reached through the browser's
// video engine, the same way the browser test does it. So when a computer-test run arrives here
// without video results, this page measures them and adds them to the run.
async function addVideo(r) {
  if (!r.native || !isCurrent(r) || r.tests.vid_enc_h264 != null || r.info.videoVia || typeof VideoEncoder === 'undefined') return false;
  state.running = { steps: [{ label: 'Video', cat: 'gpu', st: 'doing' }], now: 'Finishing the computer test · video', video: true }; render();
  try {
    const m = await runMedia({ quick: false, progress: label => { state.running.now = label; const el = document.getElementById('now'); if (el) el.textContent = label; } });
    Object.assign(r.tests, m.values); Object.assign(r.errors, m.errors); r.info.codecs = m.codecs; r.info.videoVia = state.device.browser || 'browser';
  } catch (e) { r.errors.video = msg(e); r.info.videoVia = 'failed'; }
  state.running = null;
  return true;
}

// ---------- pieces ----------
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="8" height="8"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.9 2.9M16.9 16.9l2.9 2.9M4.2 19.8l2.9-2.9M16.9 7.1l2.9-2.9"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2.5A10 10 0 1 0 21.5 15 7.5 7.5 0 0 1 15 2.5z"/></svg>';
function mast() {
  const v = location.hash.replace('#', '');
  const on = (...ids) => ids.includes(v) ? 'class="on" aria-current="page"' : '';
  const account = !acct.on ? '' : acct.user
    ? `<a href="#account" ${on('account')} class="me">${esc(acct.user.name)}${badgesFor(acct.user.username, { focus: false })}</a>`
    : `<a href="#signin" ${on('signin')}>Sign in</a><a href="#register" ${on('register')}>Create account</a>`;
  return `<header class="mast">
    <nav class="acct-nav" aria-label="Account">${account}</nav>
    <h1><a href="#home" aria-label="1000Mark home">1000<span>Mark</span></a></h1>
    <nav class="main-nav" aria-label="Main">
      <button class="go" data-act="run-full" ${state.running ? 'disabled' : ''}>Run browser test</button>
      <a href="#computer" ${on('computer', 'app')}>Run on your computer</a>
      ${state.runs.length ? `<a href="#home" ${on('home', '', ...CATS.map(c => c.id))}>Results</a><a href="#devices" ${on('devices')}>Devices</a>` : ''}
      ${acct.on ? `<a href="#leaderboard" ${on('leaderboard')}>Leaderboard</a>` : ''}
    </nav>
  </header>`;
}

const gb = bytes => { const g = bytes / 1e9; return g >= 1000 ? fmt(g / 1000) + ' TB' : fmt(g) + ' GB'; };

function deviceBlock(d, info = {}) {
  if (d.native) {
    const drives = (d.drives || []).filter(x => x.kind !== 'Removable');
    const vols = [...new Map((d.disks || []).filter(x => !/^fuse|^nfs|^cifs|^smb/i.test(x.fs)).map(x => [x.name || `${x.fs}|${x.total}`, x])).values()];
    return `<div class="block dev">
      <h2>${esc(d.cpu)}</h2>
      <div class="sub">${esc(d.os)} · ${esc(d.arch)} · ${esc(d.browser)}</div>
      <div class="lanes-head"><b>${d.physCores} cores · ${d.cores} threads</b><small>read from the system</small></div>
      ${lanes(d.cores, d.cores)}
      <dl class="kv">
        <dt>Memory</dt><dd>${ramGB(d.memoryBytes)} GB</dd>
        <dt>Graphics</dt><dd>${esc(d.gpu || 'None found')}${info.gpuApi ? ` <span class="tag">${esc(info.gpuApi)}</span>` : ''}${info.gpuAdapter ? `<br><small>${esc(info.gpuAdapter.split(' · ').slice(1).join(' · '))}</small>` : ''}</dd>
        ${drives.length ? `<dt>Drives</dt><dd>${drives.map(x => `${esc(x.model || x.name)} · ${gb(x.bytes)} · ${esc(x.kind)}`).join('<br>')}</dd>`
          : vols.length ? `<dt>Drives</dt><dd>${vols.map(x => `${x.name ? esc(x.name) + ' · ' : ''}${gb(x.total)} · ${esc(x.fs)} · ${esc(x.kind)}`).join('<br>')}</dd>` : ''}
        ${info.diskPath ? `<dt>Tested</dt><dd>${esc(info.diskPath)}${info.disk ? ` (${esc(info.disk.fs)})` : ''}</dd>` : ''}
      </dl>
    </div>`;
  }
  return `<div class="block dev">
    <h2>${esc(d.model || d.os)}</h2>
    <div class="sub">${esc(d.browser)}${d.arch ? ' · ' + esc(d.arch) : ''}</div>
    <div class="lanes-head"><b>${d.cores} threads</b><small>as the browser reports them</small></div>
    ${lanes(d.cores, d.cores)}
    <dl class="kv">
      <dt>System</dt><dd>${esc(d.os)}</dd>
      <dt>Graphics</dt><dd>${esc(info.gpuAdapter || d.gpu || 'Not reported')}${info.gpuApi ? ` <span class="tag">${esc(info.gpuApi)}</span>` : ''}</dd>
      <dt>Screen</dt><dd>${esc(d.screen)}</dd>
    </dl>
    <p class="hint">A browser only sees what it is allowed to: not the memory or drive sizes, and some (Brave, Safari, Firefox) report false thread counts and hide the graphics chip. <a href="#computer">The computer test</a> reads the real hardware.</p>
  </div>`;
}

function progress() {
  const r = state.running, doneN = r.steps.filter(s => s.st === 'done' || s.st === 'fail').length;
  return `<section class="progress">
    <div class="label">Printing your results</div>
    <div class="block now" aria-live="polite"><h2 id="now">${esc(r.now)}</h2>
      <div class="now-count"><b>${Math.min(doneN + 1, r.steps.length)} / ${r.steps.length}</b><span>${doneN} of ${r.steps.length} tests done</span></div>
      <div class="steps" role="progressbar" aria-valuemin="0" aria-valuemax="${r.steps.length}" aria-valuenow="${doneN}">${r.steps.map(s => `<span class="step ${s.st}" title="${esc(s.label)}"></span>`).join('')}</div>
      <p class="hint">${r.video ? 'The computer test measures video through your browser. This takes about fifteen seconds; leave this tab in front.' : `Leave this tab in front and avoid using the device until it finishes${r.soak ? ` (about ${r.soak + 3} minutes)` : ' (about three minutes)'}. Other work slows the tests down and lowers the score.`}</p>
      ${r.video ? '' : '<button class="btn" data-act="cancel">Stop</button>'}</div>
  </section>`;
}

function intro() {
  return `<section class="intro">
    <div class="label">Two ways to test</div>
    <section class="two-col tests">
      <div class="block test-card">
        <span class="kicker">Nothing to install</span>
        <h2>Browser test</h2>
        <p class="hint">Runs in this tab in about three minutes, with the same tests as the computer test as far as a browser allows. It shows how fast this device is through this browser. Works on phones and tablets too. Chrome, Edge and other Chromium browsers give the most complete results.</p>
        <div class="btns"><button class="btn primary" data-act="run-full">Run browser test</button><button class="btn" data-act="run-heat">With heat test · ${SOAK + 3} min</button></div>
      </div>
      <div class="block test-card app">
        <span class="kicker">Windows · Mac · Linux</span>
        <h2>Computer test</h2>
        <p class="hint">A small download you run from a terminal. It names the real processor, graphics chip and drives, uses every core and tests the drive itself. It lists each result as it goes, then opens your results here. This is the one to use for comparing computers.</p>
        <div class="btns"><a class="btn primary" href="#computer">Run on your computer</a></div>
      </div>
    </section>
    <div class="label">What the browser can see</div>
    <div class="two-col">${deviceBlock(state.device)}
      <div class="block"><h2>What gets tested</h2><div class="sub">Five parts, one system score</div>
        ${CATS.map(c => `<div class="slotrow"><span class="nm">${esc(c.name)}</span><span class="tag">${c.id === 'capacity' ? 'Computer test only' : `${share(PROFILES[0], null, c.id)}% of system score`}</span><span class="ds">${esc(c.blurb)}</span></div>`).join('')}</div>
    </div>
  </section>`;
}

function controls() {
  const g = curGroup(); if (!g) return '';
  const devs = deviceList(), d = devs.find(x => x.label === g.label);
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`;
  const many = g.runs.length > 1;
  return `<section class="controls">
    <div><label for="c-name">Device</label><select id="c-name">${devs.map(x => opt(x.label, x.label, g.label)).join('')}</select></div>
    <div><label for="c-dev">Test</label><select id="c-dev" ${d.sets.length < 2 ? 'disabled' : ''}>${d.sets.map(x => opt(x.key, `${kindName(x.kind)} · ${x.runs.length} run${x.runs.length > 1 ? 's' : ''}`, g.key)).join('')}</select></div>
    <div><label for="c-stat">Show</label><select id="c-stat">${state.pick ? opt('pick', 'One chosen run', 'pick') : ''}${STATS.map(x => opt(x.id, x.id === 'latest' ? x.name : `${x.name} of ${g.runs.length} run${many ? 's' : ''}`, state.pick ? 'pick' : state.stat)).join('')}</select></div>
    <div><label for="c-use">Use case</label><select id="c-use">${PROFILES.map(x => opt(x.id, x.name, profile().id)).join('')}</select></div>
  </section>${browserToggle() ? `<section class="lb-controls">${browserToggle()}</section>` : ''}${unitBar(selRun())}`;
}

// A part's share of the score, out of the parts this run has (all five when sc is null).
const share = (pr, sc, id) => { const tot = CATS.reduce((a, c) => a + (!sc || sc.cats[c.id] ? pr.weights[c.id] : 0), 0); return Math.round(pr.weights[id] / tot * 100); };
// Why a part has no score.
const why = (run, c) => !run.native && c.id === 'capacity' ? 'Computer test only: a browser cannot see memory or drive sizes'
  : !run.native && c.id === 'storage-speed' ? 'Not scored in a browser · see why →' : 'Could not be tested here';
function stamps(sc, cmp, run, crun) {
  const pr = profile(), P = pctOn();
  if (P) {
    const sp = pctile(run, ['s', pr.id], sc.system), cp = cmp && pctile(crun, ['s', pr.id], cmp.system);
    return `<section class="stamps">
      <div class="stamp dark sys"><span class="n">${pc(sp)}</span><span class="l">${esc(pr.score)} percentile</span><span class="s">${sp == null ? 'Not enough results yet' : `Faster than ${Math.round(sp)}% of ${vsName(run)}`}${cmp && cp != null ? ` · compared device ${pc(cp)}` : ''}</span></div>
      ${CATS.map(c => { const p = pctile(run, ['c', c.id], sc.cats[c.id]), q = cmp && pctile(crun, ['c', c.id], cmp.cats[c.id]);
        return `<a class="stamp sh-${c.ink}" href="#${c.id}"><span class="n">${pc(p)}</span><span class="l">${esc(c.name)}</span><span class="s">${!sc.cats[c.id] ? why(run, c) : p == null ? 'Not enough results yet' : `Faster than ${Math.round(p)}%${q != null ? ` · compared ${pc(q)}` : ''} · see tests →`}</span></a>`; }).join('')}
    </section>`;
  }
  const delta = (a, b) => b ? `<span class="s">${a >= b ? '+' : '−'}${Math.abs(Math.round((a / b - 1) * 100))}% vs compared device</span>` : '';
  return `<section class="stamps">
    <div class="stamp dark sys"><span class="n">${pts(sc.system)}</span><span class="l">${esc(pr.score)}</span>${cmp ? delta(sc.system, cmp.system) : `<span class="s">${pr.id === 'general' ? '1000 = reference machine' : esc(pr.blurb)}</span>`}</div>
    ${CATS.map(c => `<a class="stamp sh-${c.ink}" href="#${c.id}"><span class="n">${pts(sc.cats[c.id])}</span><span class="l">${esc(c.name)}</span>${sc.cats[c.id] ? (cmp && cmp.cats[c.id] ? delta(sc.cats[c.id], cmp.cats[c.id]) : `<span class="s">${share(pr, sc, c.id)}% of the score · see tests →</span>`) : `<span class="s">${why(run, c)}</span>`}</a>`).join('')}
  </section>`;
}
// Bar rows for a set of tests, in points or in percentiles.
function testBars(run, ids, sc, c, csc, sub) {
  const P = pctOn();
  return ids.map(id => {
    const t = TESTS[id], v = sc.tests[id], cv = csc && csc.tests[id];
    const value = P ? pctile(run, ['t', id], v) : v, cmp = P ? (cv != null ? pctile(c, ['t', id], cv) : null) : cv;
    return { label: t.name, sub: sub(id), value, text: P ? pc(value) : pts(v), note: run.tests[id] != null ? `${fmt(run.tests[id])} ${t.unit}` : (run.errors[id] ? 'failed' : ''), ink: catOf(t.cat).ink, cmp };
  });
}
const barOpts = (cmpLabel, run) => pctOn() ? { ref: 50, max: 100, cmpLabel, refText: `50% = the middle of ${vsName(run)}` } : { ref: 1000, cmpLabel };

// ---------- the app: downloads and how to run it ----------
const DOWNLOADS = [
  { id: 'mac-arm', os: 'Mac', arch: 'Apple silicon (M1 and later)', file: '1000mark-macos-arm64', shell: 'Terminal (in Applications › Utilities)' },
  { id: 'mac-intel', os: 'Mac', arch: 'Intel', file: '1000mark-macos-x86_64', shell: 'Terminal (in Applications › Utilities)' },
  { id: 'win', os: 'Windows', arch: '64-bit', file: '1000mark-windows-x86_64.exe', shell: 'PowerShell (search the Start menu for it)' },
  { id: 'linux', os: 'Linux', arch: 'x86-64', file: '1000mark-linux-x86_64', shell: 'a terminal' },
];
const cmd = t => `<code class="cmd">${esc(t)}</code>`;
function appPage() {
  const base = siteUrl(), os = (state.device.os || '').toLowerCase();
  const mine = /mac|ios/.test(os) ? 'mac-arm' : /windows/.test(os) ? 'win' : /linux/.test(os) ? 'linux' : '';
  const list = [...DOWNLOADS].sort((a, b) => (b.id === mine) - (a.id === mine));
  const card = d => {
    const url = `${REPO}/releases/latest/download/${d.file}`, win = d.id === 'win';
    const one = win ? `iwr ${url} -OutFile 1000mark.exe; .\\1000mark.exe` : `curl -fLo 1000mark ${url} && chmod +x 1000mark && ./1000mark`;
    const steps = win
      ? `<li>Download it, then double-click it.</li><li>Windows warns that it is from an unknown publisher: choose <b>More info</b>, then <b>Run anyway</b>.</li>`
      : `<li>Download it, then open ${esc(d.shell)} and run these one at a time:</li></ol>${cmd('cd ~/Downloads')}${cmd(`chmod +x ${d.file}`)}${d.os === 'Mac' ? cmd(`xattr -d com.apple.quarantine ${d.file}`) : ''}${cmd(`./${d.file}`)}<ol class="steps-list" start="2">${d.os === 'Mac' ? '<li>The xattr line stops macOS blocking an app that is not from the App Store.</li>' : ''}`;
    return `<div class="block dl ${d.id === mine ? 'mine' : ''}">
      <div class="lanes-head"><b>${esc(d.os)}</b><small>${esc(d.arch)}${d.id === mine ? ' · this device' : ''}</small></div>
      <p class="sub">Quickest: paste this into ${esc(d.shell)}</p>${cmd(one)}
      <p class="sub">Or download it</p><a class="btn primary" href="${esc(url)}" download>Download ${esc(d.file)}</a>
      <ol class="steps-list">${steps}</ol>
    </div>`;
  };
  return `<nav class="crumbs"><a href="#home">← Results</a></nav>
    <section class="cat-head"><div><h2 class="cat-title">Computer test</h2><p class="lede">The browser test can only see what the browser allows. The computer test is a small program you run from a terminal, and it reads the real hardware: every core, the actual graphics chip, the drive itself. Both run the same tests on the same scale, but a browser test measures the computer through that browser, so use the computer test to compare computers.</p></div></section>
    <div class="label">What happens when you run it</div>
    <section class="block"><ol class="steps-list big">
      <li>It takes about three minutes. Leave the computer alone while it runs, and close anything busy first (a screensaver or a video is enough to lower the scores).</li>
      <li>Each test is listed in the terminal with its result and points as it finishes, then the part scores and the system score.</li>
      <li>It opens this site with the results, and the page spends about fifteen seconds measuring video encoding and decoding through your browser, which completes the run. If you are signed in the results are saved to your account; if not, sign in or create an account and they are added to it.</li>
      <li>Add <code>--heat</code> to also load every core and the graphics chip for 12 minutes and measure how much speed is left once the computer is hot. Scores do not change; the result is shown beside them.</li>
      <li>It also saves the results as a file in the folder you ran it from, which you can load on the Devices page.</li>
    </ol></section>
    <div class="label">What it sends</div>
    <section class="block"><dl class="kv">
      <dt>Hardware</dt><dd>Processor model and core count, graphics chip and driver, memory size, drive models and sizes, operating system, and whether it is a laptop or a desktop.</dd>
      <dt>Results</dt><dd>The speed measured in each test, any tests that failed, and the power the processor and graphics chip drew where the system reports it.</dd>
      <dt>Device name</dt><dd>Named after its processor (for example "Ryzen 9 5950X desktop"), not your computer's name. You can rename it.</dd>
      <dt>Never</dt><dd>Your name, user name, files, folder names, network details or anything else on the computer.</dd>
    </dl><p class="hint">Add <code>--show-data</code> when you run it to see exactly what it sends, or <code>--local</code> to send nothing and see the results on your computer only. Results are linked to your account only when you sign in; percentiles and the leaderboard never show who you are beyond the username you choose.</p></section>
    <div class="label">Download</div>
    <section class="grid-cards">${list.map(card).join('')}</section>
    <div class="label">Check the download</div>
    <section class="block">
      <p class="hint">The computer test is built from the public code on GitHub by GitHub itself, and each release lists the SHA-256 fingerprint of every file. Read the code at <a href="${REPO}">${REPO.replace('https://', '')}</a>, compare fingerprints on the <a href="${REPO}/releases/latest">latest release</a>, or check that a download was built from that code with the GitHub command-line tool:</p>
      ${cmd('gh attestation verify 1000mark-linux-x86_64 --repo jordanneenan/1000mark')}
    </section>
    <p class="foot-note">The program is not signed by Apple or Microsoft yet, which is why the system warns about it. It sends only the results (hardware names and speeds, no files or personal details) to this site.</p>`;
}

function problems(run) {
  const errs = Object.entries(run.errors || {});
  const notes = [];
  if (!run.device.secure) notes.push('This page is not on a secure (https) address, so the browser blocked storage, GPU and video tests.');
  if (run.info.gpuApi === 'WebGL2') notes.push('This browser has no WebGPU, so the GPU was tested with the older WebGL2 drawing tests only: no compute or transfer tests.');
  if (run.info.busy > 8) notes.push(`Other programs were using about ${Math.round(run.info.busy)}% of the processor when this test started, so these scores may be lower than the computer can do. Close anything busy and run it again.`);
  if (!errs.length && !notes.length) return '';
  return `<div class="label">What could not be tested</div><section class="notes">
    ${notes.map(n => `<p class="note y">${esc(n)}</p>`).join('')}
    ${errs.map(([k, v]) => `<p class="note"><b>${esc(TESTS[k] ? TESTS[k].name : k)}</b>${esc(v)}</p>`).join('')}
  </section>`;
}

function runsBlock() {
  const g = curGroup(), cur = selRun();
  const sys = g.runs.map(r => score(r).system).filter(Boolean);
  const mean = sys.reduce((a, b) => a + b, 0) / (sys.length || 1), lo = Math.min(...sys), hi = Math.max(...sys);
  const cols = g.runs.slice(0, 14).reverse().map(r => ({ label: new Date(r.time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), value: score(r).system, sel: cur.id === r.id }));
  return `<div class="label">Runs on this device</div>
  <section class="block runs">
      <div class="lanes-head"><b>${esc(g.label)}</b><small>${kindName(g.kind)} · ${g.runs.length} run${g.runs.length > 1 ? 's' : ''}${g.runs.length > 14 ? ' · latest 14 charted' : ''}</small></div>
      ${columns(cols)}
      ${sys.length > 1 ? `<div class="spread"><span><small>Lowest</small><b>${pts(lo)}</b></span><span><small>Average</small><b>${pts(mean)}</b></span><span><small>Best</small><b>${pts(hi)}</b></span><span><small>Spread</small><b>±${(100 * (hi - lo) / 2 / mean).toFixed(1)}%</b></span></div>` : ''}
      ${g.runs.slice(0, 8).map(r => `<div class="slotrow">
        <span class="nm">${when(r.time)} · ${pts(score(r).system)}</span>
        <span class="row-btns">${cur.id === r.id ? '<span class="tag used">Showing</span>' : `<button class="mini" data-act="view" data-id="${esc(r.id)}">Show this run</button>`}<button class="mini" data-act="del" data-id="${esc(r.id)}">Delete</button></span>
        <span class="ds">${esc(r.device.browser)}${r.imported ? ' · loaded from a file' : ''}${r.mode === 'quick' ? ' · quick test' : ''}</span></div>`).join('')}
      ${g.runs.length > 8 ? `<p class="hint">${g.runs.length - 8} older runs are counted in the average but not listed.</p>` : ''}
      <div class="btns"><a class="btn" href="#devices">Compare devices</a><button class="btn" data-act="export">Save this run as a file</button></div>
  </section>`;
}

// Submit the run on screen (or, when showing an average, the latest run) to the public leaderboard.
function submitBar() {
  if (!acct.on) return '';
  const g = curGroup(), r = (state.pick && g.runs.find(x => x.id === state.pick)) || g.runs[0], on = acct.board.has(r.id);
  const what = state.pick || state.stat === 'latest' || g.runs.length === 1 ? 'this run' : `the latest run (${when(r.time)})`;
  let body;
  if (!acct.user) body = `<span>Sign in to put ${what} on the public leaderboard.</span><a class="btn" href="#signin">Sign in</a>`;
  else if (!acct.user.username) body = `<span>Choose a username to put ${what} on the leaderboard.</span><a class="btn" href="#account">Choose a username</a>`;
  else if (on) body = `<span><b>On the leaderboard</b> as ${esc(acct.user.username)}${badgesFor(acct.user.username)}.</span><a class="btn" href="#leaderboard">See the leaderboard</a><button class="btn" data-act="lb-del" data-id="${esc(r.id)}">Remove</button>`;
  else body = `<span>Put ${what} on the public leaderboard as <b>${esc(acct.user.username)}</b>${badgesFor(acct.user.username)}. It shows the hardware and scores, not the device name.</span><button class="btn primary" data-act="lb-submit" data-id="${esc(r.id)}">Submit to leaderboard</button>`;
  return `<section class="submit-bar ${on ? 'on' : ''}">${body}</section>`;
}

// ---------- leaderboard ----------
function lbName(e) { const d = e.device; return d.cpu || d.model || d.os || 'Unknown device'; }
function leaderboardPage() {
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`;
  const prof = PROFILES.find(p => p.id === lb.rank), cat = CATS.find(c => 'cat:' + c.id === lb.rank);
  const head = `<nav class="crumbs"><a href="#home">← Results</a></nav>
    <section class="cat-head"><div><h2 class="cat-title">Leaderboard</h2><p class="lede">Runs people have chosen to share. Every score is on the same fixed scale, where 1000 is ${esc(REF_DEVICE)}. First places earn badges, shown beside the username; hover one to see why and for how long.</p></div></section>`;
  if (!lb.entries) return head + `<p class="note y">${lb.error ? esc(lb.error) : 'Loading the leaderboard…'}</p>`;
  const scoreOf = e => { const s = scoreRun(e, prof || PROFILES[0]); return prof ? s.system : s.cats[cat.id]; };
  let rows = lb.entries.filter(e => e.kind === lb.kind).map(e => ({ e, v: scoreOf(e), parts: scoreRun(e).cats })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (lb.dedupe) { const seen = new Set(); rows = rows.filter(x => { const k = `${x.e.user}|${lbName(x.e)}|${x.e.device.gpu}`; if (seen.has(k)) return false; seen.add(k); return true; }); }
  const count = k => lb.entries.filter(e => e.kind === k).length;
  return head + `
    <section class="lb-controls">
      <div class="seg" role="group" aria-label="Test">${['app', 'browser'].map(k => `<button class="${lb.kind === k ? 'on' : ''}" data-act="lb-kind" data-id="${k}" aria-pressed="${lb.kind === k}">${kindName(k)} <small>${count(k)}</small></button>`).join('')}</div>
      <label>Rank by <select id="lb-rank"><optgroup label="Use cases">${PROFILES.map(p => opt(p.id, p.score, lb.rank)).join('')}</optgroup><optgroup label="Parts">${CATS.map(c => opt('cat:' + c.id, c.name, lb.rank)).join('')}</optgroup></select></label>
      <label class="chk"><input type="checkbox" id="lb-dedupe" ${lb.dedupe ? 'checked' : ''}> Best run per person and machine</label>
    </section>
    ${rows.length ? `<section class="block table-wrap"><table class="lb"><thead><tr><th class="r">#</th><th>Who</th><th>Hardware</th><th class="r">${esc(prof ? prof.score : cat.name)}</th>${CATS.map(c => `<th class="r part">${esc(c.short)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${rows.map((x, i) => `<tr class="${x.e.mine ? 'mine' : ''}"><td class="r"><span class="rank r${i + 1}">${i + 1}</span></td>
        <td><b>${esc(x.e.user)}</b>${badgesFor(x.e.user)}${x.e.mine ? ' <span class="tag used">You</span>' : ''}${x.e.review ? ' <span class="tag off" title="Much faster than other runs on the same chip. Only you can see it until it is checked.">Under review</span>' : ''}<small>${new Date(x.e.time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</small></td>
        <td>${esc(lbName(x.e))}<small>${esc([x.e.device.gpu, x.e.kind === 'app' ? x.e.device.os : x.e.device.browser].filter(Boolean).join(' · '))}</small></td>
        <td class="r score">${pts(x.v)}</td>${CATS.map(c => `<td class="r part">${pts(x.parts[c.id])}</td>`).join('')}
        <td>${x.e.mine ? `<button class="mini" data-act="lb-del" data-id="${esc(x.e.id)}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></section>` : `<p class="note y">No ${kindName(lb.kind).toLowerCase()} runs on the leaderboard yet. Run a test, then press Submit to leaderboard on your results.</p>`}
    <div class="label">Badges</div>
    <section class="block">${badgeRules()}<p class="hint">Badges come from the computer-test leaderboard, using each person's best run, and move as soon as someone beats them; a tie stays with the earlier run. Runs held for review cannot win one.</p></section>
    <p class="foot-note">Computer tests and browser tests are ranked separately, because the browser cannot reach everything the computer test does. Only the username, the hardware and the results are shown.</p>`;
}

function dashboard(run) {
  const sc = score(run), c = cmpRun(), csc = c && score(c);
  const cmpLabel = cmpText(c);
  // The chart shows only the parts this run (or the one it is compared with) has a score for.
  const axes = CATS.filter(k => sc.cats[k.id] || (csc && csc.cats[k.id]));
  const all = testBars(run, Object.keys(sc.tests), sc, c, csc, id => `${catOf(TESTS[id].cat).short} · ${TESTS[id].group}`).sort((a, b) => (b.value || 0) - (a.value || 0));
  return `${controls()}${stamps(sc, csc, run, c)}${submitBar()}
    <div class="label">Balance · ${esc(run.label)}, ${describe(run)}</div>
    <section class="two-col balance">
      <div class="block">${radar(axes.map(k => ({ label: k.name, value: sc.cats[k.id], cmp: csc && csc.cats[k.id] })), cmpLabel)}
        ${axes.length < CATS.length ? `<p class="hint">${CATS.filter(k => !axes.includes(k)).map(k => esc(k.name)).join(' and ')} ${CATS.length - axes.length > 1 ? 'are' : 'is'} left off: ${run.native ? 'not measured in this run' : 'only <a href="#computer">the computer test</a> measures them'}.</p>` : ''}</div>
      ${deviceBlock(run.device, run.info)}
    </section>
    <div class="label">Every test, strongest first</div>
    <section class="block">${bars(all, barOpts(cmpLabel, run))}</section>
    ${heatBlock(run)}
    ${powerBlock(run)}
    ${runsBlock()}
    ${problems(run)}`;
}

// Power drawn by the processor and the graphics chip, where the computer test could read it, and
// the points each got per watt. The chips' own estimates; never part of a score.
function efficiency(run) {
  const p = run.power || {}, t = scoreRun(run).tests;
  const geo = ids => { const v = ids.map(id => t[id]).filter(x => x > 0); return v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : null; };
  const all = geo(Object.keys(t).filter(id => id.startsWith('ca_'))), gpu = geo(Object.keys(t).filter(id => id.startsWith('gpu_')));
  return { cpu: p.cpuAll > 0 && all ? all / p.cpuAll : null, gpu: p.gpu > 0 && gpu ? gpu / p.gpu : null };
}
function powerBlock(run) {
  const p = run.power || {}; if (!(p.cpuAll > 0) && !(p.gpu > 0)) return '';
  const e = efficiency(run), rows = [], w = v => `${fmt(v)} W`;
  if (p.cpuAll > 0) rows.push({ label: 'Processor, all cores', value: p.cpuAll, text: w(p.cpuAll), note: e.cpu ? `${fmt(e.cpu)} points per watt` : '', ink: 'sun' });
  if (p.cpuOne > 0) rows.push({ label: 'Processor, one core', value: p.cpuOne, text: w(p.cpuOne), ink: 'sun' });
  if (p.cpuIdle > 0) rows.push({ label: 'Processor, idle', value: p.cpuIdle, text: w(p.cpuIdle), ink: 'sun' });
  if (p.gpu > 0) rows.push({ label: 'Graphics chip, in its tests', value: p.gpu, text: w(p.gpu), note: e.gpu ? `${fmt(e.gpu)} points per watt` : '', ink: 'pink' });
  if (p.gpuIdle > 0) rows.push({ label: 'Graphics chip, idle', value: p.gpuIdle, text: w(p.gpuIdle), ink: 'pink' });
  const src = [p.cpuSource && `the processor's from ${p.cpuSource}`, p.gpuSource && `the graphics chip's from ${p.gpuSource}`].filter(Boolean).join(', ');
  return `<div class="label">Power</div><section class="block">
    <div class="lanes-head"><b>Power while testing</b><small>chip estimates · not scored</small></div>
    ${bars(rows)}
    <p class="hint">${src ? `Read ${esc(src)}. ` : ''}These are estimates the chips make themselves, not measurements at the wall, and they leave out memory, drives and the power supply. Chip makers estimate differently, so use points per watt for rough comparisons ("about twice as efficient"), not small differences.${!(p.cpuAll > 0) ? ' This system does not report the processor\'s power to programs without admin rights (Windows, and Macs on recent macOS).' : ''}${!(p.gpu > 0) ? ' This graphics chip does not report its power.' : ''}</p></section>`;
}

// How much speed is left once the device is hot. Not part of any score.
function heatBlock(run) {
  const h = run.heat; if (!h || h.cpu == null) return '';
  const pct = v => Math.round(v * 100) + '%', row = (label, v, ink) => ({ label, value: Math.min(v, 1.1) * 100, text: pct(v), note: 'of its cool speed', ink });
  const rows = [row('Processor, all cores', h.cpu, 'sun')]; if (h.gpu != null) rows.push(row('Graphics chip', h.gpu, 'pink'));
  const pts = k => h.series.filter(p => p[k] != null).map(p => `${(p[0] / (h.soak * 60) * 600).toFixed(1)},${(150 - (Math.max(0.4, Math.min(1.1, p[k])) - 0.4) / 0.7 * 140).toFixed(1)}`).join(' ');
  const col = k => (h.series || []).map(p => p[k]).filter(v => v > 0), first = k => col(k)[0], last = k => col(k)[col(k).length - 1];
  const watts = k => first(k) ? h.series.filter(p => p[k] > 0).map(p => `${(p[0] / (h.soak * 60) * 600).toFixed(1)},${(150 - (Math.max(0.4, Math.min(1.1, p[k] / first(k))) - 0.4) / 0.7 * 140).toFixed(1)}`).join(' ') : '';
  const chart = h.mode === 'soak' && h.series && h.series.length > 2 ? `<svg class="heat-chart" viewBox="0 0 600 160" role="img" aria-label="Speed during the heat test, as a share of the speed at the start">
      <line x1="0" x2="600" y1="30" y2="30" class="hc-ref"/><text x="596" y="24" text-anchor="end" class="hc-t">100%</text><text x="596" y="146" text-anchor="end" class="hc-t">40% · ${h.soak} min</text>
      <polyline points="${pts(1)}" class="hc-cpu"/>${h.gpu != null ? `<polyline points="${pts(2)}" class="hc-gpu"/>` : ''}
      ${watts(3) ? `<polyline points="${watts(3)}" class="hc-cpu hc-w"/>` : ''}${watts(4) ? `<polyline points="${watts(4)}" class="hc-gpu hc-w"/>` : ''}</svg>
      <p class="hint">Speed through the heat test, with every core and the graphics chip loaded together: yellow is the processor, pink the graphics chip.${watts(3) || watts(4) ? ` The dashed lines are the power each drew, as a share of where it started${last(3) ? ` (processor ${fmt(first(3))} W, then ${fmt(last(3))} W at the end` : ' ('}${last(4) ? `${last(3) ? '; ' : ''}graphics chip ${fmt(first(4))} W, then ${fmt(last(4))} W` : ''}). A chip that cuts its power as it heats up is slowing itself down to stay cool.` : ''}</p>` : '';
  return `<div class="label">Heat</div><section class="block">
    <div class="lanes-head"><b>${h.mode === 'soak' ? `After ${h.soak} minute${h.soak > 1 ? "s" : ""} at full load` : `After ${Math.max(1, Math.round(h.minutes))} minute${Math.round(h.minutes) > 1 ? 's' : ''} of testing`}</b><small>speed kept once warm</small></div>
    ${bars(rows, { ref: 100, max: 112, refText: '100% = no slowdown' })}${chart}
    <p class="hint">${h.mode === 'soak' ? 'The scores above come from short bursts on a cool device. This is how much of that speed is left after a long, heavy load. It does not change any score.' : `This is the short check at the end of the normal test. For the real thing, run the heat test: ${run.native ? 'add <code>--heat</code> when you run the computer test' : 'choose "With heat test" when you start the browser test'}. It loads everything for ${SOAK} minutes first, which is when thin laptops and phones slow down.`}</p></section>`;
}

// ---------- part pages ----------
function extras(cat, run, c) {
  const t = run.tests, i = run.info || {}, d = run.device;
  if (cat.id === 'cpu') {
    const rows = Object.entries(TESTS).filter(([id, x]) => x.pair && t[id] && t[x.pair]);
    if (!rows.length) return '';
    return `<div class="label">How well it uses all ${d.cores} threads</div><section class="grid-cards">
      ${rows.map(([id, x]) => { const f = t[id] / t[x.pair]; return `<div class="block"><div class="lanes-head"><b>${esc(x.name)}</b><small>${f.toFixed(1)}× one core</small></div>${lanes(d.cores, f)}
        ${bars([{ label: 'One core', value: t[x.pair], note: x.unit, ink: 'sun' }, { label: 'All cores', value: t[id], note: x.unit, ink: 'pink' }])}</div>`; }).join('')}
    </section><p class="foot-note">Each square is one thread. A filled square means one more core's worth of speed. Threads that share a core (hyper-threading) and slower efficiency cores leave squares part-filled.</p>`;
  }
  if (cat.id === 'gpu') {
    const codecs = i.codecs ? Object.values(i.codecs) : [];
    const tag = (hw, sw) => hw ? '<span class="tag used">Hardware</span>' : sw ? '<span class="tag">Software</span>' : '<span class="tag off">No</span>';
    const other = Object.entries(TESTS).filter(([id, x]) => x.cat === 'gpu' && x.unscored && t[id]).map(([id, x]) => ({ label: x.name, value: t[id], note: 'fps', ink: id.includes('_enc_') ? 'pink' : 'mint', cmp: c && c.tests[id] }));
    if (d.native) return `<div class="label">Graphics chip</div><section class="block"><h2>${esc(d.gpu || 'Not found')}</h2><div class="sub">${esc(i.gpuApi || '')} · ${esc(i.gpuKind || '')} · ${esc((i.gpuAdapter || '').split(' · ').slice(1).join(' · '))}</div>
      <p class="hint">Compute, drawing, ray tracing and transfer were tested directly through ${esc((i.gpuApi || 'the graphics driver').replace(' (native)', ''))}. ${t.vid_enc_h264 != null ? `Video encoding and decoding were measured through ${esc(i.videoVia || 'the browser')} when the results opened, the same way the browser test does it.` : 'Video encoding and decoding are measured in the browser when the results page opens; this run was saved without that step, so it has no video results.'}</p>
      ${i.rayTracing ? `<p class="hint">${/^hardware/.test(i.rayTracing) ? 'The hardware ray-tracing test ran on the chip\'s ray-tracing units.' : 'No ray-tracing hardware was available to the test, so the compute result stands in for the hardware test. Either the chip has none, or the test cannot reach it yet: on Macs it cannot, even on M3 and later chips that have it, so treat this score as a lower bound there.'}</p>` : ''}</section>`;
    return `<div class="label">Graphics chip</div><section class="two-col">
      <div class="block"><h2>${esc(i.gpuApi || 'Not tested')}</h2><div class="sub">${esc(i.gpuAdapter || d.gpu || 'No adapter reported')}</div>
        <p class="hint">${i.gpuApi === 'WebGPU' ? 'Full test: compute, drawing, ray tracing, transfer and video. Browsers cannot reach ray-tracing hardware, so rays are traced in a compute shader; the computer test also uses the hardware.' : i.gpuApi === 'WebGL2' ? 'This browser has no WebGPU, so only the drawing tests ran. Try a browser with WebGPU for the compute and transfer tests.' : 'The browser gave no access to the graphics chip.'}</p></div>
      <div class="block"><h2>Video codecs</h2><div class="sub">At 1080p. Hardware means the graphics chip does the work.</div>
        ${codecs.length ? `<div class="table-wrap"><table><thead><tr><th>Codec</th><th>Encode</th><th>Decode</th></tr></thead><tbody>${codecs.map(k => `<tr><td>${esc(k.name)}</td><td>${tag(k.encHW, k.encSW)}</td><td>${tag(k.decHW, k.decSW)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">This browser could not report its video codecs.</p>'}</div>
    </section>
    ${other.length ? `<div class="label">Other codecs (shown, not scored)</div><section class="block">${bars(other)}</section>` : ''}`;
  }
  if (d.native && cat.id === 'memory') return `<p class="foot-note">Tested on 256 MB blocks, far bigger than the processor's cache, so the numbers reflect the RAM itself. This machine has ${ramGB(d.memoryBytes)} GB of memory. Each test is timed three times and the middle result kept.</p>`;
  if (d.native && cat.id === 'storage-speed') {
    const used = i.quota ? i.usage / i.quota * 100 : 0;
    return `<p class="foot-note">Tested with a ${gb(i.fileBytes || 0)} file of random data in ${esc(i.diskPath || '')}${i.disk ? `, on ${i.disk.name ? esc(i.disk.name) + ' ' : 'a '}(${esc(i.disk.fs)}, ${esc(i.disk.kind)}) volume` : ''}. ${i.direct ? 'The system cache was bypassed, so these are the drive\'s own speeds.' : 'This file system would not let the cache be bypassed, so reads may come from memory and flatter the drive.'} Big-file tests move 64 MB at a time. Random tests do one 4K request at a time (how quick the drive feels) and then 32 at once (a busy drive, where NVMe drives pull away). Each is timed three times and the middle result kept.</p>
      ${i.quota ? `<div class="label">The drive that was tested</div><section class="block"><div class="fill big"><i style="width:${used.toFixed(1)}%"></i></div>
      <dl class="kv"><dt>Size</dt><dd>${gb(i.quota)}</dd><dt>Used</dt><dd>${gb(i.usage)} (${Math.round(used)}%)</dd><dt>Free</dt><dd>${gb(i.quota - i.usage)}</dd></dl><p class="hint">The drive\'s size counts in the <a href="#capacity">Capacity</a> part, not here.</p></section>` : ''}`;
  }
  if (cat.id === 'memory') return `<p class="foot-note">Tested on a ${fmt((i.memBlock || 0) / 1048576)} MB block, much bigger than the processor's cache, so the numbers reflect the RAM itself. A browser cannot see how much memory is installed.</p>`;
  if (cat.id === 'storage-speed') return `<section class="block"><h2>Not scored in a browser</h2><p class="hint">These numbers come from a ${fmt((i.fileBytes || 0) / 1048576)} MB file in the browser's private storage. Browsers keep that storage in their own database and answer reads from memory, so they measure the browser more than the drive: in our own tests a laptop beat a desktop whose drive is much faster. They are shown here but left out of every score. <a href="#computer">The computer test</a> reads and writes the drive directly.</p></section>`;
  if (cat.id === 'capacity' && d.native) {
    const SIZES = [['sz_ram', 8, '8 GB'], ['sz_ram', 16, '16 GB'], ['sz_ram', 64, '64 GB'], ['sz_ram', 256, '256 GB'], ['sz_vram', 4, '4 GB graphics'], ['sz_vram', 24, '24 GB graphics'], ['sz_drive', 512, '512 GB drive'], ['sz_drive', 16000, '16 TB drive']];
    const counts = (id, p) => (p.groups?.capacity?.[TESTS[id].group] ?? 1) > 0;
    const pts = (id, p) => !counts(id, p) ? '<span class="off">not counted</span>' : t[id] ? fmt(scoreTest(id, t[id], p)) : '–';
    return `<div class="label">How the sizes count</div><section class="block"><p class="hint">Memory size counts in every score. Graphics memory counts where the work uses it (games, AI, design, video, engineering, science). Drive size counts only in the server score: more space does not make a computer faster, and a drive is easy to add. Size has diminishing returns, and where it stops helping depends on the use case. 32 GB of memory, 10 GB of graphics memory and a 4 TB drive score 1000 everywhere. Below 8 GB of memory points fall away fast, because the computer starts swapping to the drive. Games barely use more than 16 GB and gain nothing past 32 GB, while virtual machines, simulations, local AI models and a server's files keep using more, each doubling worth less than the last. Only the drive that was tested counts.${i.vramShared ? ' This graphics chip shares the system\'s memory, so half of it is counted as graphics memory.' : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>Use case</th><th class="r">This computer: ${t.sz_ram ? Math.round(t.sz_ram) + ' GB' : 'memory'}</th><th class="r">${t.sz_vram ? Math.round(t.sz_vram) + ' GB graphics' : 'Graphics'}</th><th class="r">${t.sz_drive ? gb(t.sz_drive * 1e9) + ' drive' : 'Drive'}</th>${SIZES.map(([id, v, l]) => `<th class="r">${l}</th>`).join('')}</tr></thead><tbody>
      ${PROFILES.map(p => `<tr${p.id === profile().id ? ' class="on"' : ''}><td>${esc(p.name)}</td><td class="r">${pts('sz_ram', p)}</td><td class="r">${pts('sz_vram', p)}</td><td class="r">${pts('sz_drive', p)}</td>${SIZES.map(([id, v]) => `<td class="r">${counts(id, p) ? fmt(scoreTest(id, v, p)) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  if (cat.id === 'capacity') return `<section class="block"><h2>Computer test only</h2><p class="hint">A browser cannot see how much memory or graphics memory there is or how big the drive is, so browser runs have no Capacity score and their system score leaves it out. <a href="#computer">Run the computer test</a> to include it.</p></section>`;
  return '';
}

function catPage(cat, run) {
  const sc = score(run), c = cmpRun(), csc = c && score(c), cmpLabel = cmpText(c);
  const ids = Object.keys(TESTS).filter(id => TESTS[id].cat === cat.id && !TESTS[id].unscored && run.tests[id] != null && sc.tests[id] != null);
  const groups = [...new Set(ids.map(id => TESTS[id].group))];
  return `${controls()}<nav class="crumbs"><a href="#home">← All results</a>${CATS.map(k => `<a href="#${k.id}" class="${k.id === cat.id ? 'on' : ''}">${esc(k.short)}</a>`).join('')}</nav>
    <section class="cat-head">
      <div><h2 class="cat-title">${esc(cat.name)}</h2><p class="lede">${esc(cat.blurb)}</p><p class="sub">${esc(run.label)} · ${describe(run)} · ${sc.cats[cat.id] ? `${share(profile(), sc, cat.id)}% of the ${esc(profile().score.toLowerCase())}` : esc(why(run, cat).replace(' · see why →', ''))}</p></div>
      ${pctOn() ? (() => { const p = pctile(run, ['c', cat.id], sc.cats[cat.id]); return `<div class="stamp dark sh-${cat.ink}"><span class="n">${pc(p)}</span><span class="l">${esc(cat.name)} percentile</span><span class="s">${p == null ? 'Not enough results yet' : `Faster than ${Math.round(p)}% of ${vsName(run)}`}</span></div>`; })()
        : `<div class="stamp dark sh-${cat.ink}"><span class="n">${pts(sc.cats[cat.id])}</span><span class="l">${esc(cat.name)} score</span><span class="s">${csc && csc.cats[cat.id] && sc.cats[cat.id] ? `${pts(csc.cats[cat.id])} on the compared device` : '1000 = reference machine'}</span></div>`}
    </section>
    ${groups.map(g => `<div class="label">${esc(g)}</div><section class="block">${bars(testBars(run, ids.filter(id => TESTS[id].group === g), sc, c, csc, id => TESTS[id].what), barOpts(cmpLabel, run))}</section>`).join('')}
    ${extras(cat, run, c)}
    <div class="label">The numbers</div>
    <section class="block table-wrap"><table><thead><tr><th>Test</th><th class="r">Result</th><th>Unit</th><th class="r">Points</th><th class="r">Reference</th></tr></thead><tbody>
      ${Object.keys(TESTS).filter(id => TESTS[id].cat === cat.id && !TESTS[id].hidden && run.tests[id] != null).map(id => `<tr><td>${esc(TESTS[id].name)}<small>${esc(TESTS[id].group)}</small></td><td class="r">${fmt(run.tests[id])}</td><td>${esc(TESTS[id].unit)}</td><td class="r">${TESTS[id].unscored ? 'not scored' : sc.tests[id] == null ? 'not counted' : pts(sc.tests[id])}</td><td class="r">${(run.native ? TESTS[id].ref : TESTS[id].bref) ? fmt(run.native ? TESTS[id].ref : TESTS[id].bref) : '–'}</td></tr>`).join('')}
    </tbody></table></section>
    ${problems({ ...run, errors: Object.fromEntries(Object.entries(run.errors || {}).filter(([k]) => (TESTS[k] ? TESTS[k].cat === cat.id : (cat.id === 'gpu' ? /gpu|gl|vid|video/.test(k) : cat.id.startsWith('storage') && /sto/.test(k))))) })}`;
}

// ---------- devices: names, and a table comparing any number of them ----------
const FF = [['desktop', 'Desktop'], ['laptop', 'Laptop'], ['computer', 'Computer'], ['phone', 'Phone'], ['tablet', 'Tablet']];
const ffOf = d => (d.sets[0].runs[0].device || {}).formFactor || 'computer';
function devicesPage() {
  const devs = deviceList(), gs = groups();
  const picked = state.cols ? gs.filter(g => state.cols.includes(g.key)) : gs.slice(0, 8);
  const cols = picked.map(g => ({ g, run: aggregate(g, state.stat) }));
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`;
  // Rows: the use-case scores, the parts, then every test. App and browser tests that measure the same
  // thing share a row (same part, group and name), so the two kinds of test can be compared directly.
  const rows = [];
  rows.push({ head: 'Use cases' });
  const P = pctOn(), conv = (run, metric, v) => P ? pctile(run, metric, v) : v;
  // "% of best": the best device in each row is 100% and the others are shown as a share of it.
  const REL = state.unit === 'rel';
  for (const p of PROFILES) rows.push({ name: p.score, sub: p.name, big: true, vals: cols.map(c => conv(c.run, ['s', p.id], scoreRun(c.run, p).system)) });
  rows.push({ head: 'Parts' });
  for (const c of CATS) rows.push({ name: c.name, big: true, vals: cols.map(x => conv(x.run, ['c', c.id], scoreRun(x.run).cats[c.id])) });
  for (const c of CATS) {
    const keys = [...new Set(Object.entries(TESTS).filter(([, t]) => t.cat === c.id && !t.unscored).map(([, t]) => `${t.group}|${t.name}`))];
    const order = [...new Set(keys.map(k => k.split('|')[0]))]; keys.sort((a, b) => order.indexOf(a.split('|')[0]) - order.indexOf(b.split('|')[0]));
    const body = keys.map(k => {
      const vals = [], tips = [];
      for (const x of cols) {
        const id = Object.keys(x.run.tests).find(i => TESTS[i] && !TESTS[i].unscored && `${TESTS[i].group}|${TESTS[i].name}` === k);
        vals.push(id ? conv(x.run, ['t', id], scoreRun(x.run).tests[id]) : null); tips.push(id ? `${fmt(x.run.tests[id])} ${TESTS[id].unit}` : '');
      }
      return vals.some(v => v != null) ? { name: k.split('|')[1], sub: k.split('|')[0], vals, tips } : null;
    }).filter(Boolean);
    if (body.length) rows.push({ head: c.name }, ...body);
  }
  if (!P && cols.some(x => x.run.heat && x.run.heat.cpu != null)) {
    const h = k => cols.map(x => x.run.heat && x.run.heat[k] != null && !x.run.agg ? Math.round(x.run.heat[k] * 100) : null);
    rows.push({ head: 'Heat: speed kept once warm (latest run, not scored)' }, { name: 'Processor', sub: 'All cores', vals: h('cpu'), pct: true }, { name: 'Graphics chip', vals: h('gpu'), pct: true },
      { name: 'Minutes of load', vals: cols.map(x => x.run.heat && !x.run.agg ? Math.round(x.run.heat.minutes) : null), plain: true, nomark: true });
  }
  if (!P && cols.some(x => x.run.power && (x.run.power.cpuAll > 0 || x.run.power.gpu > 0))) {
    const pw = k => cols.map(x => x.run.power && x.run.power[k] > 0 && !x.run.agg ? Math.round(x.run.power[k]) : null), ef = k => cols.map(x => { const v = !x.run.agg && efficiency(x.run)[k]; return v ? +v.toFixed(1) : null; });
    rows.push({ head: 'Power: chip estimates (latest run, not scored)' }, { name: 'Processor watts', sub: 'All cores', vals: pw('cpuAll'), plain: true, nomark: true }, { name: 'Processor points per watt', sub: 'All cores', vals: ef('cpu'), plain: true },
      { name: 'Graphics chip watts', vals: pw('gpu'), plain: true, nomark: true }, { name: 'Graphics chip points per watt', vals: ef('gpu'), plain: true });
  }
  const cell = (r, i) => {
    const v = r.vals[i], nums = r.vals.filter(x => x != null);
    if (v == null) return '<td class="r none">–</td>';
    const hi = Math.max(...nums), lo = Math.min(...nums), many = nums.length > 1 && hi !== lo;
    const cls = r.nomark ? '' : many && state.marks.best && v === hi ? 'best' : many && state.marks.worst && v === lo ? 'worst' : '';
    if (REL && !r.pct && !r.nomark) return `<td class="r ${cls}" title="${esc(`${r.plain ? v : pts(v) + ' points'}${r.tips && r.tips[i] ? ' · ' + r.tips[i] : ''}`)}"><span>${hi > 0 ? Math.round(v / hi * 100) : 0}%</span></td>`;
    return `<td class="r ${cls}" ${r.tips && r.tips[i] ? `title="${esc(r.tips[i])}"` : ''}><span>${r.plain ? v : P || r.pct ? pc(v) : pts(v)}</span></td>`;
  };
  return `<nav class="crumbs"><a href="#home">← Results</a></nav>
    <section class="cat-head"><div><h2 class="cat-title">Devices</h2><p class="lede">Every device you have tested. Name them, and compare as many as you like side by side.</p></div></section>
    <div class="label">Your devices</div>
    <section class="two-col">
      <div class="block runs">
        ${devs.map(d => `<div class="slotrow">
          <span class="nm">${esc(d.label)}</span>
          <span class="row-btns"><select class="mini" data-ff="${esc(d.label)}" aria-label="Type of device">${FF.map(([v, t]) => `<option value="${v}" ${ffOf(d) === v ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="mini" data-act="rename" data-id="${esc(d.label)}">Rename</button><button class="mini" data-act="del-dev" data-id="${esc(d.label)}">Delete</button></span>
          <span class="ds">${d.sets.map(g => `${kindName(g.kind)}: ${g.runs.length} run${g.runs.length > 1 ? 's' : ''}, last ${when(g.runs[0].time)}`).join(' · ')}</span></div>`).join('')}
        <p class="hint">Set what kind of device each one is, so percentiles compare it with the right machines. Give two devices the same name to merge them, for example the computer-test runs and browser runs from one machine.</p>
      </div>
      <div class="block form">
        <h2>This browser</h2>
        <label for="label">Browser tests run here are saved under</label>
        <input id="label" value="${esc(state.label)}" placeholder="${esc(state.device.model || state.device.os)}" autocomplete="off" maxlength="40">
        <p class="hint">Use the same name the computer test gives this machine to keep both kinds of test under one device.</p>
        <div class="btns"><label class="btn" for="imp">Load runs from files</label><input id="imp" type="file" accept="application/json,.json" multiple hidden></div>
      </div>
    </section>
    <div class="label">Compare</div>
    <section class="block">
      ${browserToggle() ? `<div class="lb-controls">${browserToggle()}</div>` : ''}
      <div class="picker">${gs.map(g => `<button class="mini ${picked.includes(g) ? 'on' : ''}" data-act="col" data-id="${esc(g.key)}" aria-pressed="${picked.includes(g)}">${esc(g.label)} · ${g.kind === 'app' ? 'computer' : 'browser'}</button>`).join('')}</div>
      <div class="cmp-opts">
        <label>Show <select id="c-stat">${STATS.map(x => opt(x.id, x.name, state.stat)).join('')}</select></label>
        <div class="seg" role="group" aria-label="Show scores as">${[['points', 'Points'], ['rel', '% of best'], ...(acct.on ? [['pct', 'Percentile']] : [])].map(([id, t]) => { const on = id === 'pct' ? P : id === 'rel' ? REL : !P && !REL; return `<button class="${on ? 'on' : ''}" data-act="unit" data-id="${id}" aria-pressed="${on}">${t}</button>`; }).join('')}</div>
        ${P ? `<label>Against <select id="c-vs">${VS.map(x => opt(x.id, x.id === 'auto' ? 'Each device\'s own kind' : x.name, state.vs)).join('')}</select></label>` : ''}
        <label><input type="checkbox" data-mark="best" ${state.marks.best ? 'checked' : ''}> <span class="swatch best"></span> Mark the best</label>
        <label><input type="checkbox" data-mark="worst" ${state.marks.worst ? 'checked' : ''}> <span class="swatch worst"></span> Mark the lowest</label>
      </div>
      ${cols.length ? `<div class="table-wrap"><table class="compare"><thead><tr><th>${P ? 'Percentile' : REL ? '% of best' : 'Points'}</th>${cols.map(c => `<th class="r">${esc(c.g.label)}<small>${kindName(c.g.kind)}${c.run.agg ? ` · ${c.run.agg.n} runs` : ''}</small></th>`).join('')}</tr></thead><tbody>
        ${rows.map(r => r.head ? `<tr class="grp"><th colspan="${cols.length + 1}">${esc(r.head)}</th></tr>` : `<tr class="${r.big ? 'big' : ''}"><td>${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</td>${r.vals.map((_, i) => cell(r, i)).join('')}</tr>`).join('')}
      </tbody></table></div><p class="hint">${REL ? 'In each row the best of the devices shown is 100% and the others are a share of it; hover a figure for its points. ' : ''}1000 points = ${esc(REF_DEVICE)}. Hover a test's points to see the measured value. Browser tests share rows with the computer test's, but they measure the computer through a browser: compare like with like.</p>` : '<p class="hint">Pick at least one device above.</p>'}
    </section>`;
}

// ---------- account pages ----------
const notes = () => (state.old && !state.runs.length ? `<p class="note y" role="status">${state.old} earlier run${state.old > 1 ? 's were' : ' was'} made before suite 1.0, with different tests, and cannot be compared with new ones. Run the test again to replace ${state.old > 1 ? 'them' : 'it'}.</p>` : '') + (acct.note ? `<p class="note y" role="status">${esc(acct.note)}</p>` : '') + (acct.busy ? `<p class="note" role="status">${esc(acct.busy)}</p>` : '');
// Sign in and create account are separate pages (password managers need one form per page),
// drawn as one printed card with two stamped tabs so they read as a pair.
function authPage(kind) {
  const reg = kind === 'register', busy = acct.busy;
  const tab = (id, label) => `<a href="#${id}" class="${kind === id ? 'on' : ''}" ${kind === id ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<section class="auth">
    <div class="auth-card">
      <nav class="auth-tabs" aria-label="Account">${tab('signin', 'Sign in')}${tab('register', 'Create account')}</nav>
      <form class="auth-form form" data-form="${reg ? 'register' : 'login'}" action="#${kind}" method="post">
        <h2 class="auth-title">${reg ? 'New account' : 'Welcome back'}</h2>
        <p class="auth-lede">${reg ? 'An email, a password and a username for the leaderboard.' : 'Sign in to see every device\'s runs, from any browser.'}</p>
        ${acct.note ? `<p class="auth-msg" role="alert">${esc(acct.note)}${/support request/.test(acct.note) ? ' <a href="#support" data-act="support-unlock">Send one</a>.' : ''}</p>` : ''}
        <label for="${reg ? 'rg' : 'li'}-email">Email</label>
        <input id="${reg ? 'rg' : 'li'}-email" name="email" type="email" autocomplete="username" autocapitalize="off" spellcheck="false" required>
        <label for="${reg ? 'rg' : 'li'}-pass">Password${reg ? ' <small>10 characters or more</small>' : ''}</label>
        <input id="${reg ? 'rg' : 'li'}-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" ${reg ? 'minlength="10"' : ''} required>
        ${reg ? `<label for="rg-user">Username <small>shown on the leaderboard</small></label>
        <input id="rg-user" name="username" type="text" autocomplete="nickname" autocapitalize="off" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,23}" title="3 to 24 letters, numbers, dots, dashes or underscores. No spaces." required>
        <p class="auth-hint">No spaces. Letters, numbers, dots, dashes and underscores. It has to be unique.</p>` : ''}
        ${reg ? '<div class="hp" aria-hidden="true"><label for="rg-web">Leave this empty</label><input id="rg-web" name="website" type="text" tabindex="-1" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore></div>' : ''}
        <button class="btn primary wide" ${busy ? 'disabled' : ''}>${busy ? esc(busy) : reg ? 'Create account' : 'Sign in'}</button>
        <p class="auth-fine">${reg ? 'Pressing the button runs a short automatic check that keeps bots out. There is no password reset by email yet, so let your password manager save the password.' : 'Forgotten your password, or locked out? There is no reset by email yet. <a href="#support" data-act="support-open">Ask for help</a>.'}</p>
      </form>
    </div>
    <aside class="auth-side">
      <span class="kicker">What an account does</span>
      <dl class="perks">
        <dt>Every device in one place</dt><dd>Runs from your phone, laptop and desktop sit side by side, ready to compare.</dd>
        <dt>Computer tests land here</dt><dd>When the computer test finishes it opens this site, and the run is saved to your account.</dd>
        <dt>${state.runs.length ? `${state.runs.length} run${state.runs.length > 1 ? 's' : ''} in this browser` : 'Nothing is lost'}</dt><dd>${state.runs.length ? 'They are added to the account as soon as you sign in.' : 'Runs you make before signing in are added to the account when you do.'}</dd>
        <dt>A place on the leaderboard</dt><dd>Submit any run to the public leaderboard. It shows your username and the hardware, never your email or device names.</dd>
      </dl>
    </aside>
  </section>`;
}

// ---------- support: a request to unlock an account, or anything else ----------
function supportPage() {
  const v = acct.supportSent;
  return `<nav class="crumbs"><a href="#home">← Results</a></nav>
    <section class="cat-head"><div><h2 class="cat-title">Support</h2><p class="lede">Locked out, or something not working? Send a request and it will be answered by email.</p></div></section>
    ${v ? `<p class="note y" role="status">Request sent. You will get an email reply, usually within a few days.</p>` : `
    <form class="block form narrow" data-form="support" action="#support" method="post">
      ${acct.note ? `<p class="auth-msg" role="alert">${esc(acct.note)}</p>` : ''}
      <label for="sp-kind">What do you need?</label>
      <select id="sp-kind" name="kind"><option value="unlock" ${acct.supportKind === 'unlock' ? 'selected' : ''}>Unlock my account</option><option value="other" ${acct.supportKind === 'unlock' ? '' : 'selected'}>Something else</option></select>
      <label for="sp-email">Your email <small>the one on the account, if it is about an account</small></label>
      <input id="sp-email" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required>
      <label for="sp-msg">Message</label>
      <textarea id="sp-msg" name="message" rows="6" maxlength="4000" placeholder="For an unlock, nothing more is needed. Otherwise, tell us what happened."></textarea>
      <div class="hp" aria-hidden="true"><label for="sp-web">Leave this empty</label><input id="sp-web" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <button class="btn primary" ${acct.busy ? 'disabled' : ''}>${acct.busy ? esc(acct.busy) : 'Send request'}</button>
      <p class="hint">Your email is stored encrypted and used only to reply. Accounts locked after too many wrong passwords are unlocked by hand, after checking the request.</p>
    </form>`}`;
}

function accountPage() {
  const u = acct.user, devs = deviceList();
  return `<nav class="crumbs"><a href="#home">← Results</a></nav>
    <section class="cat-head"><div><h2 class="cat-title">Account</h2><p class="lede">${esc(u.email)}</p><p class="sub">Account since ${new Date(u.created).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} · ${state.runs.length} run${state.runs.length === 1 ? '' : 's'} on ${devs.length} device${devs.length === 1 ? '' : 's'} · <a href="#devices">rename or compare devices</a></p></div>
      <div><button class="btn" data-act="signout">Sign out</button></div></section>
    ${notes()}
    ${(() => { const mine = (lb.badges || {})[u.username] || [];
      return `<div class="label">Your badges</div><section class="block">${mine.length ? `<div class="bd-mine">${mine.map(b => `<div class="bd-rule"><span class="badge t-${b.tier} big">${medal(b.tier)}</span><div><b>${esc(b.title)}</b><span>${esc(b.why)}</span><small>Held for ${heldFor(b.since)} · since ${new Date(b.since).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div></div>`).join('')}</div>`
        : `<p class="hint">${u.username ? 'None yet. Submit a computer-test run to the <a href="#leaderboard">leaderboard</a> and take first place somewhere to earn one.' : 'Choose a username below and submit a computer-test run to the leaderboard to start earning badges.'}</p>`}
        <details class="bd-how"><summary>How badges are earned</summary>${badgeRules()}</details></section>`; })()}
    <div class="label">Username</div>
    <section class="block">
      <form class="form inline" data-form="username"><label for="un-name">${u.username ? 'Shown on the leaderboard' : 'Choose a username to appear on the leaderboard'}</label><input id="un-name" name="username" value="${esc(u.username || '')}" autocomplete="nickname" autocapitalize="off" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,23}" title="3 to 24 letters, numbers, dots, dashes or underscores. No spaces." required><button class="btn">${u.username ? 'Change' : 'Save'}</button></form>
      <p class="hint">No spaces. Letters, numbers, dots, dashes and underscores. Nobody else can have the same one.</p>
    </section>
    <div class="label">Connect a computer for good (optional)</div>
    <section class="block">
      <p class="hint">The computer test already brings its results here when it finishes. A key lets a computer save runs straight to this account without a browser, for example a machine you test unattended. Make one key per computer.</p>
      ${acct.newKey ? `<div class="keybox"><b>On that computer, run the test once with this added to the end. After that, run it as usual.</b><code>--connect ${esc(acct.newKey)} --server ${esc(location.origin)}</code><small>This key is shown only now. If you lose it, remove it below and make another.</small></div>` : ''}
      ${acct.keys.map(k => `<div class="slotrow"><span class="nm">${esc(k.label)}</span><span class="row-btns"><button class="mini" data-act="key-del" data-id="${esc(k.id)}">Remove</button></span><span class="ds">Made ${when(new Date(k.created).toISOString())} · ${k.last_used ? 'last used ' + when(new Date(k.last_used).toISOString()) : 'not used yet'}</span></div>`).join('')}
      <form class="form inline" data-form="key"><label for="k-label">Name for the computer</label><input id="k-label" name="label" placeholder="e.g. ThinkPad" maxlength="60" autocomplete="off"><button class="btn">Make a key</button></form>
    </section>
    <div class="label">Password and account</div>
    <section class="two-col">
      <form class="block form" data-form="password">
        <h2>Change password</h2>
        <input type="email" name="username" autocomplete="username" value="${esc(u.email)}" hidden>
        <label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autocomplete="current-password" required>
        <label for="pw-new">New password <small>(10 characters or more)</small></label><input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="10" required>
        <button class="btn">Change password</button>
        <p class="hint">This signs you out everywhere else.</p>
      </form>
      <form class="block form" data-form="delete">
        <h2>Delete account</h2>
        <p class="hint">Removes the account and every run stored in it, for good. Runs already in this browser are cleared too.</p>
        <input type="email" name="username" autocomplete="username" value="${esc(u.email)}" hidden>
        <label for="dl-pass">Password</label><input id="dl-pass" name="password" type="password" autocomplete="current-password" required>
        <button class="btn">Delete my account</button>
      </form>
    </section>`;
}

async function submitForm(kind, f) {
  const v = Object.fromEntries(new FormData(f)); acct.note = '';
  const working = t => { acct.busy = t; render(); };
  try {
    if (kind === 'support') {
      working('Checking you are not a bot…'); const pow = await solvePuzzle();
      working('Sending…'); await api('support', 'POST', { ...v, pow }); acct.supportSent = true; acct.busy = ''; render(); return;
    }
    if (kind === 'login' || kind === 'register') {
      working('Checking you are not a bot…'); const pow = await solvePuzzle();
      working(kind === 'login' ? 'Signing in…' : 'Creating your account…');
      const r = await api(kind, 'POST', { ...v, pow });
      if (!r.user) throw new Error('That did not work. Try again.');
      acct.user = r.user; acct.busy = '';
      try { await pullAccount(); } catch (e) { acct.note = `Signed in, but your runs could not be loaded: ${msg(e)}`; }
      location.hash = state.runs.length ? 'home' : 'account'; render(); return;
    }
    if (kind === 'username') { working('Saving…'); acct.user = (await api('username', 'POST', { username: v.username })).user; acct.note = `Your username is now ${acct.user.username}.`; if (lb.entries) await loadBoard(); }
    if (kind === 'key') { working('Making a key…'); acct.newKey = (await api('keys', 'POST', { label: v.label })).key; acct.keys = (await api('keys')).keys; }
    if (kind === 'password') { working('Changing your password…'); await api('password', 'POST', v); acct.note = 'Password changed. Other devices have been signed out.'; }
    if (kind === 'delete') {
      if (!confirm('Delete your account and all its runs? This cannot be undone.')) return;
      working('Deleting your account…'); await api('account/delete', 'POST', v);
      acct.user = null; acct.keys = []; acct.newKey = ''; acct.board = new Set(); lb.entries = null; state.runs = []; save(); acct.note = 'Your account has been deleted.';
    }
  } catch (e) { acct.note = msg(e); }
  acct.busy = ''; render();
}

// ---------- render + events ----------
function render() {
  tips = []; hideTip();
  const view = location.hash.replace('#', ''), cat = catOf(view), run = selRun();
  const acctView = ['account', 'signin', 'register'].includes(view) && acct.on;
  let body;
  if (state.running) body = progress();
  else if (acctView) body = acct.user ? accountPage() : authPage(view === 'register' ? 'register' : 'signin');
  else if (view === 'computer' || view === 'app') body = appPage();
  else if (view === 'support' && acct.on) body = supportPage();
  else if (view === 'leaderboard' && acct.on) { body = leaderboardPage(); if (!lb.entries && !lb.loading && !lb.error) loadBoard().then(render); }
  else if (view === 'devices' && state.runs.length) body = devicesPage();
  else if (!run) body = notes() + intro();
  else if (cat) body = catPage(cat, run);
  else body = notes() + dashboard(run);
  app.innerHTML = `${mast()}${body}<footer><button class="theme" data-act="theme" aria-label="${isDark() ? 'Switch to light' : 'Switch to dark'}">${isDark() ? SUN : MOON}<span>${isDark() ? 'Light' : 'Dark'}</span></button>${acct.on ? '<a class="foot-link" href="#support" data-act="support-open">Support</a>' : ''}<span>${acct.user ? `Signed in as ${esc(acct.user.email)}` : acct.on ? 'Results stay in this browser until you sign in' : 'Results stay in this browser'}</span></footer>`;
}

app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  const inGroup = key => state.runs.filter(r => groupKey(r) === key);
  if (act === 'run-full') run();
  else if (act === 'run-heat') run(SOAK);
  else if (act === 'support-unlock') { acct.supportKind = 'unlock'; acct.note = ''; acct.supportSent = false; }
  else if (act === 'support-open') { acct.note = ''; acct.supportSent = false; }
  else if (act === 'unit') { state.unit = id; store.set('pressmark.unit', id); render(); }
  else if (act === 'lb-kind') { lb.kind = id; render(); }
  else if (act === 'lb-submit') {
    const r = state.runs.find(x => x.id === id); if (!r) return; b.disabled = true; b.textContent = 'Submitting…';
    api('leaderboard', 'POST', { run: r }).then(() => loadBoard()).catch(err => { acct.note = msg(err); }).finally(render);
  }
  else if (act === 'lb-del') { b.disabled = true; api('leaderboard/delete', 'POST', { id }).then(() => loadBoard()).catch(err => { acct.note = msg(err); }).finally(render); }
  else if (act === 'col') { const all = groups().map(g => g.key); let cur = state.cols ? state.cols.filter(k => all.includes(k)) : all.slice(0, 8); cur = cur.includes(id) ? cur.filter(k => k !== id) : [...cur, id]; state.cols = cur; store.set('pressmark.cols', cur); render(); }
  else if (act === 'cancel') { state.abort = true; b.textContent = 'Stopping after this test'; b.disabled = true; }
  else if (act === 'signout') { api('logout', 'POST', {}).catch(() => {}).finally(() => { acct.user = null; acct.keys = []; acct.newKey = ''; acct.board = new Set(); lb.entries = null; state.runs = []; save(); acct.note = 'Signed out. Your runs are safe in your account.'; location.hash = 'signin'; render(); }); }
  else if (act === 'key-del') { api('keys/delete', 'POST', { id }).then(async () => { acct.keys = (await api('keys')).keys; acct.newKey = ''; render(); }).catch(err => { acct.note = msg(err); render(); }); }
  else if (act === 'theme') { state.theme = isDark() ? 'light' : 'dark'; store.set('pressmark.theme', state.theme); applyTheme(); render(); }
  else if (act === 'dev') { state.dev = id; state.pick = null; if (state.cmp === id) state.cmp = null; render(); }
  else if (act === 'view') { state.pick = id; render(); }
  else if (act === 'cmp') { state.cmp = state.cmp === id ? null : id; render(); }
  else if (act === 'del') { state.runs = state.runs.filter(r => r.id !== id); if (state.pick === id) state.pick = null; save(); dropRuns([id]); render(); }
  else if (act === 'del-dev') {
    const list = state.runs.filter(r => (r.label || 'Unnamed device') === id), n = list.length;
    if (!confirm(`Delete ${id} and all ${n} of its run${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
    dropRuns(list.map(r => r.id));
    state.runs = state.runs.filter(r => !list.includes(r)); state.dev = null; state.pick = null; state.cmp = null; save(); render();
  }
  else if (act === 'rename') {
    const name = (prompt('New name for this device. Use the name of another device to merge the two.', id) || '').trim().slice(0, 60); if (!name || name === id) return;
    const list = state.runs.filter(r => (r.label || 'Unnamed device') === id);
    for (const r of list) r.label = name;
    if (state.label === id) { state.label = name; store.set('pressmark.label', name); }
    if (state.cols) { state.cols = state.cols.map(k => k.split('|')[0] === id ? `${name}|${k.split('|')[1]}` : k); store.set('pressmark.cols', state.cols); }
    if (state.dev && state.dev.split('|')[0] === id) state.dev = `${name}|${state.dev.split('|')[1]}`;
    state.cmp = null; save(); pushRuns(list); render();
  }
  else if (act === 'export') {
    const g = curGroup(); const r = g && ((state.pick && g.runs.find(x => x.id === state.pick)) || g.runs[0]); if (!r) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ pressmark: 1, ...r }, null, 1)], { type: 'application/json' }));
    a.download = `1000mark-${(r.label || 'device').replace(/[^\w-]+/g, '-').toLowerCase()}-${r.time.slice(0, 19).replace(/:/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
});
app.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'label') { state.label = t.value.trim(); store.set('pressmark.label', state.label); }
  if (t.id === 'c-vs') { state.vs = t.value; store.set('pressmark.vs', t.value); render(); }
  if (t.dataset.ff) {
    const list = state.runs.filter(r => (r.label || 'Unnamed device') === t.dataset.ff);
    for (const r of list) r.device = { ...r.device, formFactor: t.value };
    save(); pushRuns(list); render();
  }
  if (t.id === 'show-browser') { state.showBrowser = t.checked; store.set('pressmark.showBrowser', t.checked); state.dev = null; state.pick = null; state.cmp = null; state.cols = null; render(); }
  if (t.id === 'lb-rank') { lb.rank = t.value; render(); }
  if (t.id === 'lb-dedupe') { lb.dedupe = t.checked; render(); }
  if (t.dataset.mark) { state.marks = { ...state.marks, [t.dataset.mark]: t.checked }; store.set('pressmark.marks', state.marks); render(); }
  if (t.id === 'c-name') { const d = deviceList().find(x => x.label === t.value), cur = curGroup(); const g = d.sets.find(x => x.kind === cur.kind) || d.sets[0]; state.dev = g.key; state.pick = null; if (state.cmp === g.key) state.cmp = null; render(); }
  if (t.id === 'c-dev') { state.dev = t.value; state.pick = null; if (state.cmp === t.value) state.cmp = null; render(); }
  if (t.id === 'c-stat' && t.value !== 'pick') { state.stat = t.value; state.pick = null; store.set('pressmark.stat', state.stat); render(); }
  if (t.id === 'c-use') { state.profile = t.value; store.set('pressmark.profile', state.profile); render(); }
  if (t.id === 'imp') {
    let last = null;
    for (const f of t.files) {
      try { const r = JSON.parse(await f.text()); if (!r.pressmark || !r.tests || !r.device) throw new Error('not a 1000Mark results file');
        if (!isCurrent(r)) throw new Error('it was made before suite 1.0, with different tests');
        normalise(r); r.imported = true; if (state.runs.some(x => x.id === r.id)) continue;
        state.runs.push(r); last = r; pushRuns([r]); } catch (err) { alert(`${f.name} could not be loaded: ${msg(err)}`); }
    }
    if (last && curGroup() && groupKey(last) !== curGroup().key) state.cmp = groupKey(last);
    state.runs = state.runs.slice(-KEEP); save(); render();
  }
});
app.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); if (!acct.busy) submitForm(f.dataset.form, f); });
window.addEventListener('hashchange', () => { render(); if (catOf(location.hash.replace('#', ''))) window.scrollTo(0, 0); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!state.theme) render(); });

applyTheme();
state.device = await detect();
// Is there an account server behind this page? (No when the app or a plain file server serves it.)
try { const r = await fetch('api/me', { credentials: 'same-origin' }); if (r.ok && /json/.test(r.headers.get('content-type') || '')) { acct.on = true; acct.user = (await r.json()).user; } } catch {}
// When this page is served by the Pressmark app, it offers the run it just made.
try {
  const res = await fetch('native-run.json', { cache: 'no-store' });
  if (res.ok) { const r = await res.json(); if (r && r.pressmark && r.tests && isCurrent(r)) { normalise(r); render(); await addVideo(r); state.runs = [r, ...state.runs.filter(x => x.id !== r.id)].slice(0, KEEP); save(); state.dev = groupKey(r); } }
} catch {}
// The app hands its results over through the site: #claim=TOKEN.
const claim = /^#claim=([\w-]{16,})$/.exec(location.hash);
if (claim) {
  history.replaceState(null, '', location.pathname + location.search + '#home');
  if (acct.on) {
    try {
      const r = normalise((await api('handoff/' + claim[1])).run);
      if (!isCurrent(r)) throw new Error('That run came from an older version of the computer test, with different tests. Download the current one and run it again.');
      render(); await addVideo(r);
      state.runs = [r, ...state.runs.filter(x => x.id !== r.id)].slice(0, KEEP); save();
      state.dev = groupKey(r); state.pick = null; state.cmp = null;
      if (!state.label) { state.label = r.label; store.set('pressmark.label', r.label); }
      if (acct.user) await pushRuns([r]);
      else acct.note = 'These computer test results are kept in this browser for now. Sign in or create an account to save them to it.';
    } catch (e) { acct.note = msg(e); }
  }
}
if (acct.user) { try { await pullAccount(); } catch (e) { acct.note = msg(e); } }
render();
if (acct.on) loadPop().then(() => { if (state.unit === 'pct' || location.hash === '#devices') render(); });
