/**
 * Core logic for the concise-compaction plugin (kept separate so it can be
 * tested with plain Node).
 *
 * buildLedger() turns a session's messages into verified facts taken from tool
 * results (not from the model's memory): which files were successfully
 * written/edited, which calls failed, and the user's latest request.
 * The plugin then checks each file on disk and hands the facts to the
 * summarizer so the summary can't mark finished work as "not done".
 */

import path from 'node:path';

const WRITE_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit', 'apply_patch']);

export const COMPACTION_PROMPT = `Summarize this session so work can resume after the history is cleared.
Be brief and factual: under 200 words, short bullets, no preamble.

Use exactly these five sections:
**Goal:** one sentence: what the user asked for, in their words where possible.
**Done:** one bullet per finished item: path + a few words. Every file in the VERIFIED LEDGER below is done and must be listed here.
**Not done:** only requested items that are NOT in the ledger. Write "none" if empty.
**Next step:** the single next action. Never a file already in the ledger unless the user explicitly asked to change it.
**Open questions:** questions from the user that have not been answered yet, or "none".

Rules:
- The VERIFIED LEDGER comes from real tool results and the file system. If it disagrees with the conversation, trust the ledger.
- If a file was written many times, it was already done after the first write; do not mention the repeats as progress.
- Do not include code, file contents, background, or anything not needed to resume.`;

function relPath(p, root) {
  if (!root) return p;
  const rel = path.relative(root, p);
  // Outside the project: keep the full path. Inside: short, forward-slash form.
  return rel.startsWith('..') || path.isAbsolute(rel) ? p : rel.split(path.sep).join('/');
}

/**
 * @param {Array<{info:{role:string}, parts:Array<any>}>} messages
 * @param {{root?: string}} opts
 */
export function buildLedger(messages, opts = {}) {
  const files = new Map();     // path -> { writes, lastTime }
  const failures = new Map();  // "tool path" -> { count, error }
  let lastUserText = '';
  let lastUserTime = 0;

  for (const m of messages) {
    for (const p of m.parts || []) {
      if (m.info?.role === 'user' && p.type === 'text' && !p.synthetic && p.text?.trim()) {
        lastUserText = p.text.trim();
        lastUserTime = p.time?.start ?? m.info?.time?.created ?? lastUserTime;
      }
      if (p.type !== 'tool') continue;
      const st = p.state || {};
      const input = st.input || {};
      const file = input.filePath ?? input.file_path ?? input.path;
      if (WRITE_TOOLS.has(p.tool) && file && st.status === 'completed') {
        const f = files.get(file) || { writes: 0, lastTime: 0 };
        f.writes += 1;
        f.lastTime = st.time?.end ?? f.lastTime;
        files.set(file, f);
      } else if (st.status === 'error') {
        const target = file ?? (input.command ? String(input.command).slice(0, 60) : '');
        const key = `${p.tool} ${target}`.trim();
        const f = failures.get(key) || { count: 0, error: '', file: file ? String(file).replace(/\\ /g, ' ') : null };
        f.count += 1;
        f.time = st.time?.end ?? st.time?.start ?? p.time?.start ?? 0;
        f.error = String(st.error || '').split('\n')[0].slice(0, 120);
        failures.set(key, f);
      }
    }
  }
  // Keep only failures from the current request that were not fixed by a later successful write.
  for (const [key, f] of failures) {
    const fixed = f.file && files.get(f.file)?.lastTime > f.time;
    if (fixed || f.time < lastUserTime) failures.delete(key);
  }
  return { files, failures, lastUserText, lastUserTime, root: opts.root };
}

/**
 * @param {ReturnType<typeof buildLedger>} ledger
 * @param {(path:string)=>({size:number}|null)} statFn  returns null if missing
 */
export function formatLedger(ledger, statFn) {
  const lines = ['VERIFIED LEDGER (from tool results + disk check):'];
  if (ledger.lastUserText) {
    lines.push(`Latest user message: "${ledger.lastUserText.slice(0, 300)}"`);
  }
  lines.push('Files successfully written or edited (DONE):');
  if (!ledger.files.size) lines.push('- none');
  for (const [path, f] of ledger.files) {
    const st = statFn(path);
    const disk = st ? `exists, ${st.size} bytes` : 'MISSING on disk now';
    const repeats = f.writes > 3 ? `; written ${f.writes}x, likely a loop, do not rewrite` : '';
    lines.push(`- ${relPath(path, ledger.root)} (${disk}${repeats})`);
  }
  if (ledger.failures.size) {
    lines.push('Unresolved failures since the latest user message:');
    for (const [key, f] of [...ledger.failures].slice(-8)) {
      lines.push(`- ${key}: ${f.error}${f.count > 1 ? ` (${f.count}x)` : ''}`);
    }
  }
  return lines.join('\n');
}
