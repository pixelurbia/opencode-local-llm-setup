#!/usr/bin/env node
/**
 * Install this OpenCode setup on this machine (macOS, Linux, Windows; Node 18+).
 *
 *   node install.mjs [--base-url <url>] [--config-dir <dir>] [--watchdog] [--dry-run]
 *
 *   --base-url    OpenAI-compatible endpoint of your model server
 *                 (asked interactively if omitted; default http://localhost:1234/v1)
 *   --config-dir  where OpenCode reads config (default: $OPENCODE_CONFIG_DIR or ~/.config/opencode)
 *   --watchdog    also start the loop watchdog automatically at login (needs Node 22.5+)
 *   --dry-run     show what would happen, change nothing
 *
 * Existing files that would be overwritten are backed up first. An existing
 * opencode.json/jsonc is never replaced: the new settings are written next to
 * it as opencode.setup.jsonc for you to merge.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'opencode');
const CTX = path.join(HERE, 'context');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry-run');
const WATCHDOG = argv.includes('--watchdog');
const expandHome = (p) => (p && (p.startsWith('~/') || p.startsWith('~\\')) ? path.join(os.homedir(), p.slice(2)) : p);
const TARGET = path.resolve(expandHome(opt('--config-dir') || process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode')));

if (!fs.existsSync(SRC)) { console.error(`Run this from the unzipped opencode-setup folder (missing ${SRC}).`); process.exit(1); }

const log = (s) => console.log(DRY ? `[dry-run] ${s}` : s);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(TARGET, `backup-${stamp}`);
let backedUp = 0;

function copyFile(from, to) {
  if (fs.existsSync(to)) {
    if (Buffer.compare(fs.readFileSync(from), fs.readFileSync(to)) === 0) return 'same';
    const b = path.join(backupDir, path.relative(TARGET, to));
    if (!DRY) { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(to, b); }
    backedUp++;
  }
  if (!DRY) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  return 'copied';
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 18) { console.error('Node 18 or newer is required.'); process.exit(1); }

  // 1. Model server address
  let baseUrl = opt('--base-url');
  if (!baseUrl && process.stdin.isTTY && !DRY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    baseUrl = (await rl.question('Model server URL (OpenAI-compatible) [http://localhost:1234/v1]: ')).trim();
    rl.close();
  }
  baseUrl ||= 'http://localhost:1234/v1';

  log(`Installing into ${TARGET}`);

  // 2. Files
  let copied = 0;
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f);
    if (rel === 'opencode.template.jsonc') continue;
    if (copyFile(f, path.join(TARGET, rel)) === 'copied') { copied++; log(`  + ${rel}`); }
  }
  // Keep the installer and README with the setup so /package-setup can share it onward.
  for (const [from, rel] of [[path.join(HERE, 'install.mjs'), path.join('scripts', 'install.mjs')],
                             [path.join(HERE, 'README.md'), path.join('scripts', 'README.share.md')]]) {
    if (fs.existsSync(from) && copyFile(from, path.join(TARGET, rel)) === 'copied') { copied++; log(`  + ${rel}`); }
  }
  if (fs.existsSync(CTX)) {
    for (const f of walk(CTX)) {
      const rel = path.join('context', path.relative(CTX, f));
      if (copyFile(f, path.join(TARGET, rel)) === 'copied') { copied++; log(`  + ${rel}`); }
    }
  }

  // 3. Config
  let template = fs.readFileSync(path.join(SRC, 'opencode.template.jsonc'), 'utf8').replaceAll('{{LLM_BASE_URL}}', baseUrl);
  const defaultDir = path.join(os.homedir(), '.config', 'opencode');
  if (path.resolve(TARGET) !== path.resolve(defaultDir)) {
    // Installed somewhere non-standard: point instruction paths at that folder.
    template = template.replaceAll('~/.config/opencode/', `${TARGET.split(path.sep).join('/')}/`);
    log(`  Note: non-default config folder. Commands/subagents still call node ~/.config/opencode/...;`);
    log(`  update those paths in agents/loop-guard.md and commands/package-setup.md if needed.`);
  }
  const existing = ['opencode.jsonc', 'opencode.json'].map((f) => path.join(TARGET, f)).find((f) => fs.existsSync(f));
  let configNote;
  if (existing) {
    const side = path.join(TARGET, 'opencode.setup.jsonc');
    if (!DRY) fs.writeFileSync(side, template);
    configNote = `You already have ${path.basename(existing)}; it was NOT changed.\n  Merge the settings you want from ${side} into it.`;
  } else {
    if (!DRY) fs.writeFileSync(path.join(TARGET, 'opencode.jsonc'), template);
    configNote = `Wrote opencode.jsonc (model server: ${baseUrl}). Edit the model name/limits there to match your model.`;
  }
  log(`  ${configNote}`);

  // 4. Watchdog autostart (optional)
  if (WATCHDOG) {
    if (major < 22 || (major === 22 && minor < 5)) {
      log('  Watchdog skipped: it needs Node 22.5+ (built-in SQLite). Upgrade Node and re-run with --watchdog.');
    } else {
      installWatchdog();
    }
  }

  console.log(`
Done${DRY ? ' (dry run, nothing changed)' : ''}: ${copied} file(s) installed${backedUp ? `, ${backedUp} previous file(s) backed up to ${backupDir}` : ''}.
Next:
  1. Fully quit and reopen OpenCode.
  2. In a new session type @ and check that "worker" and "loop-guard" are listed.
  3. Try /package-setup to confirm commands work.`);
}

function installWatchdog() {
  const node = process.execPath;
  const script = path.join(TARGET, 'watchdog', 'loop-watchdog.js');
  const logFile = path.join(TARGET, 'watchdog', 'watchdog.log');
  if (process.platform === 'darwin') {
    const label = 'opencode.loop-watchdog';
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${logFile}</string><key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`;
    log(`  Watchdog: macOS LaunchAgent ${plist}`);
    if (!DRY) {
      fs.mkdirSync(path.dirname(plist), { recursive: true });
      fs.writeFileSync(plist, xml);
      const uid = String(process.getuid());
      try { execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
      execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist]);
    }
  } else if (process.platform === 'linux') {
    const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'opencode-loop-watchdog.service');
    const body = `[Unit]\nDescription=OpenCode loop watchdog\n\n[Service]\nExecStart="${node}" "${script}"\nRestart=always\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n`;
    log(`  Watchdog: systemd user service ${unit}`);
    if (!DRY) {
      fs.mkdirSync(path.dirname(unit), { recursive: true });
      fs.writeFileSync(unit, body);
      try {
        execFileSync('systemctl', ['--user', 'daemon-reload']);
        execFileSync('systemctl', ['--user', 'enable', '--now', 'opencode-loop-watchdog.service']);
      } catch (e) {
        log(`  Could not start it with systemctl (${e.message.split('\n')[0]}). Run: node "${script}"`);
      }
    }
  } else if (process.platform === 'win32') {
    log('  Watchdog: Windows scheduled task "OpenCodeLoopWatchdog" (runs at logon)');
    if (!DRY) {
      execFileSync('schtasks', ['/Create', '/F', '/SC', 'ONLOGON', '/TN', 'OpenCodeLoopWatchdog',
        '/TR', `"${node}" "${script}"`], { stdio: 'inherit' });
    }
  } else {
    log(`  Watchdog: no autostart for ${process.platform}. Run it manually: node "${script}"`);
  }
}

main().catch((e) => { console.error(`Install failed: ${e.message}`); process.exit(1); });
