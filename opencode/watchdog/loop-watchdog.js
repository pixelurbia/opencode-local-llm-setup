#!/usr/bin/env node
/**
 * OpenCode loop watchdog (macOS, Linux, Windows; Node 22.5+)
 *
 * Watches OpenCode's local database (read-only) and alerts when a session
 * looks stuck:
 *   - REPEAT:  the same tool call with identical input N times in a row
 *   - CHURN:   the same file written/edited many times in a short window
 *   - IGNORED: a user message has gone unanswered while tools keep running
 * Alerts are scoped to the current user turn, so a loop that returns after a
 * new message is reported again.
 *
 * It never writes to the database or touches sessions; stopping a session is
 * left to you (Esc / Stop in OpenCode).
 *
 * Usage:
 *   node loop-watchdog.js                   watch continuously
 *   node loop-watchdog.js --once            one check; exit 1 if anything is stuck
 *   node loop-watchdog.js --session <id>    show the last few tool calls of a session
 *
 * Env overrides:
 *   OC_DB              path to opencode.db
 *   WATCH_INTERVAL_S   poll interval (default 15)
 *   REPEAT_THRESHOLD   identical consecutive calls to flag (default 4)
 *   CHURN_THRESHOLD    writes to one file within the window (default 6)
 *   WINDOW_MIN         how far back to look (default 10)
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultDbPath() {
  const candidates = [
    process.env.OPENCODE_DATA_DIR,
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, 'opencode'),
    path.join(os.homedir(), '.local', 'share', 'opencode'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'opencode'),
  ].filter(Boolean);
  for (const dir of candidates) {
    const db = path.join(dir, 'opencode.db');
    if (fs.existsSync(db)) return db;
  }
  return path.join(candidates[0], 'opencode.db');
}

const DB = process.env.OC_DB || defaultDbPath();
const INTERVAL = Number(process.env.WATCH_INTERVAL_S || 15) * 1000;
const REPEAT = Number(process.env.REPEAT_THRESHOLD || 4);
const CHURN = Number(process.env.CHURN_THRESHOLD || 6);
const WINDOW_MS = Number(process.env.WINDOW_MIN || 10) * 60 * 1000;
const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const SESSION = args.includes('--session') ? args[args.indexOf('--session') + 1] : null;

// ---- database access: built-in node:sqlite, falling back to the sqlite3 CLI ----
let db = null;
try {
  process.removeAllListeners('warning'); // hide the "experimental" notice on older Node
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB, { readOnly: true });
} catch {
  db = null;
}

function query(sql, ...params) {
  if (db) return db.prepare(sql).all(...params);
  // Fallback: sqlite3 CLI (inline params; values here are numbers or session ids)
  let i = 0;
  const inlined = sql.replace(/\?/g, () => {
    const v = params[i++];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
  const out = execFileSync('sqlite3', ['-readonly', '-json', DB, inlined], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}

// ---- notifications: macOS, Linux, Windows; console always ----
function notify(title, msg) {
  try {
    if (process.platform === 'darwin') {
      const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execFileSync('osascript', ['-e', `display notification "${esc(msg)}" with title "${esc(title)}" sound name "Basso"`]);
    } else if (process.platform === 'linux') {
      execFileSync('notify-send', [title, msg]);
    } else if (process.platform === 'win32') {
      const esc = (s) => String(s).replace(/'/g, "''");
      execFileSync('powershell', ['-NoProfile', '-Command',
        `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null; ` +
        `$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; ` +
        `$n.Visible = $true; $n.ShowBalloonTip(10000, '${esc(title)}', '${esc(msg)}', 'Warning'); Start-Sleep 11; $n.Dispose()`],
        { stdio: 'ignore', timeout: 15000 });
    }
  } catch { /* no notifier available: console output still happens */ }
}

// ---- detection ----
const TOOL_ROWS = `
  select time_created as t,
         json_extract(data,'$.tool') as tool,
         json_extract(data,'$.state.input') as input,
         coalesce(json_extract(data,'$.state.input.filePath'), json_extract(data,'$.state.input.path')) as file
  from part
  where session_id = ? and json_extract(data,'$.type') = 'tool' and time_created > ?
    and json_extract(data,'$.state.status') in ('completed','error')
  order by time_created`;

const alerted = new Set();

function check() {
  const since = Date.now() - WINDOW_MS;
  const sessions = query(
    `select s.id, s.title from session s
     where exists (select 1 from part p where p.session_id = s.id and p.time_updated > ?)`, since);
  const findings = [];

  for (const s of sessions) {
    const tools = query(TOOL_ROWS, s.id, since);
    if (!tools.length) continue;

    const [u] = query(
      `select max(time_created) as t from message where session_id = ? and json_extract(data,'$.role') = 'user'`, s.id);
    const turn = (u && u.t) || 0;

    // REPEAT
    const last = tools[tools.length - 1];
    const sig = (c) => `${c.tool}|${c.input}`;
    let run = 0;
    for (let i = tools.length - 1; i >= 0 && sig(tools[i]) === sig(last); i--) run++;
    if (run >= REPEAT) {
      findings.push({ s, kind: 'REPEAT', key: `R:${turn}:${sig(last)}`,
        msg: `${last.tool} called ${run}x in a row with identical input${last.file ? ` (${path.basename(last.file)})` : ''}` });
    }

    // CHURN
    const perFile = {};
    for (const c of tools) {
      if ((c.tool === 'write' || c.tool === 'edit') && c.file) perFile[c.file] = (perFile[c.file] || 0) + 1;
    }
    for (const [file, n] of Object.entries(perFile)) {
      if (n >= CHURN) findings.push({ s, kind: 'CHURN', key: `C:${turn}:${file}`,
        msg: `${path.basename(file)} written ${n}x in the last ${WINDOW_MS / 60000} min` });
    }

    // IGNORED
    if (turn) {
      const [r] = query(
        `select
           (select count(*) from part where session_id = ? and time_created > ? and json_extract(data,'$.type') = 'tool') as calls,
           (select count(*) from part p join message m on m.id = p.message_id
              where p.session_id = ? and p.time_created > ? and json_extract(m.data,'$.role') = 'assistant'
              and json_extract(p.data,'$.type') = 'text'
              and length(trim(coalesce(json_extract(p.data,'$.text'),''))) > 0) as texts`,
        s.id, turn, s.id, turn);
      if (r.calls >= 25 && r.texts === 0) findings.push({ s, kind: 'IGNORED', key: `I:${turn}`,
        msg: `${r.calls} tool calls since your last message and no reply text` });
    }
  }

  for (const f of findings) {
    const key = `${f.s.id}:${f.key}`;
    const line = `[${new Date().toLocaleTimeString()}] ${f.kind} — "${f.s.title}" (${f.s.id}): ${f.msg}`;
    if (ONCE) { console.log(line); continue; }
    if (!alerted.has(key)) {
      alerted.add(key);
      console.log(line);
      notify(`OpenCode looks stuck (${f.kind})`, `${f.s.title}: ${f.msg}. Press Esc/Stop in OpenCode.`);
    }
  }
  return findings;
}

function showSession(id) {
  const rows = query(
    `select time_created as t, json_extract(data,'$.tool') as tool, json_extract(data,'$.state.status') as status,
            substr(json_extract(data,'$.state.input'), 1, 300) as input,
            substr(coalesce(json_extract(data,'$.state.error'), json_extract(data,'$.state.output'), ''), 1, 200) as result
     from part where session_id = ? and json_extract(data,'$.type') = 'tool'
     order by time_created desc limit 5`, id);
  if (!rows.length) { console.log(`No tool calls found for session ${id}.`); return; }
  for (const r of rows.reverse()) {
    console.log(`${new Date(r.t).toLocaleTimeString()} ${r.tool} [${r.status}]\n  input:  ${r.input}\n  result: ${r.result.replace(/\s+/g, ' ')}`);
  }
}

if (!fs.existsSync(DB)) {
  console.error(`OpenCode database not found at ${DB}. Set OC_DB to its location.`);
  process.exit(2);
}

if (SESSION) {
  showSession(SESSION);
} else if (ONCE) {
  const f = check();
  if (!f.length) console.log('No loops detected.');
  process.exit(f.length ? 1 : 0);
} else {
  console.log(`Watching ${DB} every ${INTERVAL / 1000}s (repeat>=${REPEAT}, churn>=${CHURN}, window ${WINDOW_MS / 60000}m)`);
  const tick = () => { try { check(); } catch (e) { console.error('check failed:', e.message); } };
  tick();
  setInterval(tick, INTERVAL);
}
