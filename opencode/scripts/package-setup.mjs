#!/usr/bin/env node
/**
 * package-setup — bundle this OpenCode setup into a shareable, machine-independent zip.
 *
 * Works on macOS, Linux and Windows (Node 18+). No dependencies.
 *
 * What goes in (opencode-setup/...):
 *   README.md, install.mjs                     how to install on another machine
 *   opencode/opencode.template.jsonc           your config with machine-specific values replaced
 *   opencode/delegation.md, agents/, plugins/, watchdog/, commands/, scripts/, skills/
 *   context/                                   every file listed under "instructions" in your config
 *   project/<name>/                            anything passed with --include (e.g. a project's agents folder)
 *
 * What never goes in: auth.json, databases, logs, node_modules, .env, backups.
 * The build FAILS if any file contains your home path, username, git email,
 * a private-network IP address or something that looks like an API key.
 *
 * Usage:
 *   node package-setup.mjs [--include <path>]... [--out <file.zip>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'opencode-setup';
const HOME = os.homedir();

// ---------- args ----------
const argv = process.argv.slice(2);
const includes = [];
let out = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--include') includes.push(argv[++i]);
  else if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '-h' || argv[i] === '--help') {
    console.log('Usage: node package-setup.mjs [--include <path>]... [--out <file.zip>]');
    process.exit(0);
  } else if (argv[i]) includes.push(argv[i]); // bare paths are treated as --include
}
const expandHome = (p) => {
  // "~/.config/opencode/..." means "this config folder", even when it's installed elsewhere.
  const m = p.match(/^~[\\/]\.config[\\/]opencode(?:[\\/](.*))?$/);
  if (m) return path.join(CONFIG_DIR, m[1] || '');
  return p === '~' ? HOME : p.startsWith('~/') || p.startsWith('~\\') ? path.join(HOME, p.slice(2)) : p;
};
if (!out) {
  const desktop = path.join(HOME, 'Desktop');
  out = path.join(fs.existsSync(desktop) ? desktop : process.cwd(), 'opencode-setup.zip');
}
out = path.resolve(expandHome(out));

const problems = [];
const fail = (msg) => { console.log(`\nFAILED: ${msg}`); process.exit(1); };

// ---------- helpers ----------
const EXCLUDE = [/(^|[\\/])node_modules([\\/]|$)/, /(^|[\\/])\.git([\\/]|$)/, /(^|[\\/])auth\.json$/i,
  /\.db(-wal|-shm)?$/i, /\.log$/i, /(^|[\\/])\.env(\..*)?$/i, /\.bak[^\\/]*$/i, /(^|[\\/])\.DS_Store$/];
const excluded = (p) => EXCLUDE.some((re) => re.test(p));

function walk(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (excluded(full)) continue;
    if (e.isDirectory()) files.push(...walk(full));
    else if (e.isFile()) files.push(full);
  }
  return files;
}

// Strip // and /* */ comments and trailing commas from JSONC, respecting strings.
function parseJsonc(text) {
  let res = '', inStr = false, i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) { res += c; if (c === '\\') { res += n; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; res += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    res += c; i++;
  }
  return JSON.parse(res.replace(/,(\s*[}\]])/g, '$1'));
}

// ---------- collect files ----------
const entries = new Map(); // zip path -> Buffer
const add = (zipPath, buf) => {
  const p = `${ROOT}/${zipPath.split(path.sep).join('/')}`;
  if (entries.has(p)) problems.push(`duplicate path in package: ${p}`);
  entries.set(p, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
};

// 1. Config -> template
const cfgFile = ['opencode.jsonc', 'opencode.json'].map((f) => path.join(CONFIG_DIR, f)).find(fs.existsSync);
if (!cfgFile) fail(`no opencode.jsonc or opencode.json in ${CONFIG_DIR}`);
const cfgText = fs.readFileSync(cfgFile, 'utf8');
let cfg;
try { cfg = parseJsonc(cfgText); } catch (e) { fail(`could not parse ${path.basename(cfgFile)}: ${e.message}`); }

// 2. Instruction files -> context/ (config-folder files stay under opencode/)
const contextFiles = [];
for (const raw of cfg.instructions || []) {
  if (/^https?:\/\//.test(raw)) continue;
  const abs = path.resolve(path.dirname(cfgFile), expandHome(raw));
  const matches = /[*?]/.test(abs)
    ? (fs.existsSync(path.dirname(abs)) ? fs.readdirSync(path.dirname(abs))
        .filter((f) => new RegExp(`^${path.basename(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(f))
        .map((f) => path.join(path.dirname(abs), f)) : [])
    : [abs];
  for (const f of matches) {
    if (!fs.existsSync(f)) { problems.push(`instruction file listed in config but missing: ${raw}`); continue; }
    if (!path.relative(CONFIG_DIR, f).startsWith('..')) continue; // inside config dir: packaged below
    contextFiles.push(f);
  }
}
const seenCtx = new Set();
for (const f of contextFiles) {
  const name = path.basename(f);
  if (seenCtx.has(name)) { problems.push(`two context files are both named ${name}`); continue; }
  seenCtx.add(name);
  add(`context/${name}`, fs.readFileSync(f));
}

// Template: machine-specific values -> placeholders / portable paths
const configRelInstr = (cfg.instructions || [])
  .map((raw) => path.resolve(path.dirname(cfgFile), expandHome(raw)))
  .filter((f) => !path.relative(CONFIG_DIR, f).startsWith('..'))
  .map((f) => `~/.config/opencode/${path.relative(CONFIG_DIR, f).split(path.sep).join('/')}`);
const portableInstr = [...new Set([...configRelInstr, ...(contextFiles.length ? ['~/.config/opencode/context/*.md'] : [])])];
let template = cfgText
  .replace(/("baseURL"\s*:\s*")[^"]*(")/g, '$1{{LLM_BASE_URL}}$2')
  .replace(/("apiKey"\s*:\s*")(?!\{env:)[^"]*(")/g, '$1{env:LLM_API_KEY}$2')
  .replace(/"instructions"\s*:\s*\[[\s\S]*?\]/, `"instructions": [\n${portableInstr.map((p) => `    "${p}"`).join(',\n')}\n  ]`);
try { parseJsonc(template); } catch (e) { fail(`generated template is not valid JSON: ${e.message}`); }
add('opencode/opencode.template.jsonc', template);

// 3. Config-folder pieces
const CONFIG_PARTS = [
  [/^[^\\/]+\.md$/, true],                         // delegation.md and other root rules files
  [/^agents[\\/].+\.md$/],
  [/^plugins[\\/][^\\/]+\.(js|mjs|ts)$/],
  [/^watchdog[\\/][^\\/]+\.(js|mjs)$/],
  [/^commands[\\/].+\.md$/],
  [/^skills[\\/]/],
  [/^scripts[\\/](package-setup\.mjs)$/],
];
for (const f of walk(CONFIG_DIR)) {
  const rel = path.relative(CONFIG_DIR, f);
  if (rel === 'scripts/install.mjs' || rel === path.join('scripts', 'install.mjs')) { add('install.mjs', fs.readFileSync(f)); continue; }
  if (rel === path.join('scripts', 'README.share.md')) { add('README.md', fs.readFileSync(f)); continue; }
  // Context files installed inside the config folder (by install.mjs) go back to top-level context/.
  if (/^context[\\/].+\.md$/.test(rel)) {
    const name = path.basename(rel);
    if (!seenCtx.has(name)) { seenCtx.add(name); contextFiles.push(f); add(`context/${name}`, fs.readFileSync(f)); }
    continue;
  }
  if (CONFIG_PARTS.some(([re]) => re.test(rel))) add(`opencode/${rel}`, fs.readFileSync(f));
}
if (![...entries.keys()].some((k) => k.endsWith('/install.mjs'))) problems.push('scripts/install.mjs missing: package would have no installer');

// 4. --include extras -> project/<name>/
const projectDeps = new Set();
for (const inc of includes) {
  const abs = path.resolve(expandHome(inc));
  if (!fs.existsSync(abs)) { problems.push(`--include path not found: ${inc}`); continue; }
  const base = path.basename(abs);
  const files = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
  for (const f of files) {
    const rel = fs.statSync(abs).isDirectory() ? path.join(base, path.relative(abs, f)) : base;
    const buf = fs.readFileSync(f);
    add(`project/${rel}`, buf);
    if (/\.(c?js|mjs)$/.test(f)) {
      for (const m of buf.toString('utf8').matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)|from\s+['"]([^'"./][^'"]*)['"]/g)) {
        const mod = (m[1] || m[2]);
        if (!mod.startsWith('node:') && !['fs', 'path', 'os', 'crypto', 'url', 'zlib', 'child_process', 'util', 'events', 'assert', 'http', 'https'].includes(mod.split('/')[0])) {
          projectDeps.add(mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0]);
        }
      }
    }
  }
}
if (includes.length) {
  add('project/DEPENDENCIES.md',
    `# Project files\n\nThese came from \`--include\`. Copy them into a project folder, then install what they use:\n\n` +
    (projectDeps.size ? `\`\`\`bash\nnpm install ${[...projectDeps].sort().join(' ')}\n\`\`\`\n` : 'No npm packages needed.\n'));
}

// ---------- privacy scan ----------
const username = os.userInfo().username;
let gitEmail = '';
try { gitEmail = execFileSync('git', ['config', '--global', 'user.email'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CHECKS = [
  ['home folder path', new RegExp(esc(HOME).replace(/\\\\/g, '[\\\\/]'), 'i')],
  username.length >= 3 && ['your username', new RegExp(`\\b${esc(username)}\\b`, 'i')],
  gitEmail && ['your git email', new RegExp(esc(gitEmail), 'i')],
  ['private network IP', /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['API key or token', /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bpa]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/],
].filter(Boolean);
const leaks = [];
for (const [name, buf] of entries) {
  if (name.endsWith('/scripts/package-setup.mjs')) continue; // contains the patterns themselves
  const text = buf.toString('utf8');
  if (text.includes('\u0000')) continue; // binary
  text.split('\n').forEach((line, i) => {
    for (const [label, re] of CHECKS) if (re.test(line)) leaks.push(`${name.slice(ROOT.length + 1)}:${i + 1}  ${label}`);
  });
}

if (problems.length) fail(`\n- ${problems.join('\n- ')}`);
if (leaks.length) fail(`private details found, nothing was written:\n- ${leaks.join('\n- ')}\nRemove them from those files (or replace with placeholders) and run again.`);

// ---------- write zip (stored+deflate, no dependencies) ----------
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = zlib.crc32 ? (b) => zlib.crc32(b) >>> 0 : (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const d = new Date();
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

const chunks = [], central = [];
let offset = 0;
for (const [name, data] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
  const nameBuf = Buffer.from(name, 'utf8');
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = comp.length < data.length;
  const body = useDeflate ? comp : data;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); cen.writeUInt32LE(offset, 42);
  chunks.push(local, nameBuf, body);
  central.push(cen, nameBuf);
  offset += local.length + nameBuf.length + body.length;
}
const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
const existed = fs.existsSync(out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...chunks, cenBuf, end]));

// ---------- verify by reading the zip back ----------
const zip = fs.readFileSync(out);
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const count = zip.readUInt16LE(eocd + 10);
let p = zip.readUInt32LE(eocd + 16);
const readBack = new Map();
for (let i = 0; i < count; i++) {
  const method = zip.readUInt16LE(p + 10), crc = zip.readUInt32LE(p + 16), csize = zip.readUInt32LE(p + 20);
  const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32), loff = zip.readUInt32LE(p + 42);
  const name = zip.toString('utf8', p + 46, p + 46 + nlen);
  const lstart = loff + 30 + zip.readUInt16LE(loff + 26) + zip.readUInt16LE(loff + 28);
  const raw = zip.subarray(lstart, lstart + csize);
  const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
  readBack.set(name, crc32(data) === crc && Buffer.compare(data, entries.get(name) || Buffer.alloc(0)) === 0);
  p += 46 + nlen + elen + clen;
}
const bad = [...entries.keys()].filter((k) => !readBack.get(k));
if (bad.length || readBack.size !== entries.size) fail(`zip read-back mismatch: ${bad.join(', ') || 'entry count differs'}`);

// ---------- report ----------
const groups = {};
for (const k of [...entries.keys()].sort()) {
  const rel = k.slice(ROOT.length + 1);
  const g = rel.includes('/') ? rel.split('/').slice(0, rel.startsWith('opencode/') ? 2 : 1).join('/') : '(top level)';
  (groups[g] ||= []).push(rel);
}
console.log(`Packaged OpenCode setup -> ${out}${existed ? ' (replaced previous file)' : ''}`);
console.log(`${entries.size} files, ${(zip.length / 1024).toFixed(1)} KB\n`);
for (const [g, files] of Object.entries(groups)) console.log(`${g}  (${files.length})\n  ${files.join('\n  ')}`);
console.log(`
Checks:
  ✅ format: .zip
  ✅ location: ${path.dirname(out)}
  ✅ config exported as a template (LLM address -> {{LLM_BASE_URL}}, paths -> ~/.config/opencode/...)
  ✅ ${contextFiles.length} context file(s), ${[...entries.keys()].filter((k) => /\/agents\/.+\.md$/.test(k) && k.includes('/opencode/')).length} subagent(s), ${[...entries.keys()].filter((k) => k.includes('/opencode/plugins/')).length} plugin(s)
  ✅ privacy scan: no home paths, username, email, private IPs or keys; no auth.json, databases, logs or node_modules
  ✅ zip read back and every file matches`);
