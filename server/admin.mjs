// 1000Mark admin, run on the server:
//   docker exec ix-pressmark-pressmark-1 node /app/server/admin.mjs <command>
//   requests              open support requests
//   unlock <email>        clear an email's sign-in lockout
//   close <id>            mark a support request done
//   locked                emails currently locked (shown only for accounts)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, 'data'));
const KEYS = JSON.parse(fs.readFileSync(path.resolve(process.env.KEYS_FILE || path.join(DATA, '..', 'keys', 'keys.json')), 'utf8'));
const EMAIL_KEY = Buffer.from(KEYS.emailKey, 'base64'), INDEX_KEY = Buffer.from(KEYS.emailIndexKey, 'base64');
const idx = e => crypto.createHmac('sha256', INDEX_KEY).update(String(e).trim().toLowerCase()).digest('base64url');
function open(s) {
  const [v, iv, tag, ct] = String(s).split('.'); if (v !== 'v1') return '?';
  const d = crypto.createDecipheriv('aes-256-gcm', EMAIL_KEY, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
const db = new DatabaseSync(path.join(DATA, 'pressmark.db'));
const [cmd, arg] = process.argv.slice(2);
const when = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
if (cmd === 'requests') {
  const rows = db.prepare("SELECT * FROM support WHERE status = 'open' ORDER BY created").all();
  if (!rows.length) console.log('No open requests.');
  for (const r of rows) {
    const g = db.prepare('SELECT tier, locked_until FROM guard WHERE email_idx = ?').get(r.email_idx);
    const acct = db.prepare('SELECT username FROM users WHERE email_idx = ?').get(r.email_idx);
    console.log(`#${r.id}  ${when(r.created)}  ${r.kind}  ${open(r.email_enc)}  account: ${acct ? acct.username || '(no username)' : 'none'}  lock: ${g ? (g.tier >= 3 ? 'until unlocked' : g.locked_until > Date.now() ? 'until ' + when(g.locked_until) : 'none') : 'none'}\n    ${r.message.replace(/\n/g, '\n    ') || '(no message)'}`);
  }
} else if (cmd === 'unlock' && arg) {
  const n = db.prepare('DELETE FROM guard WHERE email_idx = ?').run(idx(arg)).changes;
  console.log(n ? `Unlocked ${arg}.` : `${arg} was not locked.`);
} else if (cmd === 'close' && arg) {
  console.log(db.prepare("UPDATE support SET status = 'closed' WHERE id = ?").run(+arg).changes ? `Closed #${arg}.` : `No request #${arg}.`);
} else if (cmd === 'locked') {
  const rows = db.prepare('SELECT g.*, u.email_enc, u.username FROM guard g JOIN users u ON u.email_idx = g.email_idx WHERE g.tier >= 3 OR g.locked_until > ?').all(Date.now());
  for (const r of rows) console.log(`${open(r.email_enc)}  ${r.username || ''}  ${r.tier >= 3 ? 'until unlocked' : 'until ' + when(r.locked_until)}`);
  if (!rows.length) console.log('No accounts locked.');
} else {
  console.log('Commands: requests | unlock <email> | close <id> | locked');
}
