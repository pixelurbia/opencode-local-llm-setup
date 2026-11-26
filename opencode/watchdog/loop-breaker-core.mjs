/**
 * Core logic for the loop-breaker OpenCode plugin. Kept separate so it can be
 * tested with plain Node (OpenCode treats every export of a plugin file as a plugin).
 *
 * Per session it tracks:
 *   - identical consecutive tool calls (same tool + same args)
 *   - how often each file was written/edited within a time window
 * and decides whether the next call should be blocked. After too many blocks
 * the session should be aborted.
 */

export const DEFAULTS = {
  maxIdentical: 3,        // 3rd identical call in a row is blocked
  maxFileWrites: 5,       // writes to one file allowed per window
  windowMs: 5 * 60_000,
  maxBlocks: 3,           // after this many blocks in one turn -> abort
};

const WRITE_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit', 'apply_patch']);

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

function filesOf(tool, args = {}) {
  if (!WRITE_TOOLS.has(tool)) return [];
  const f = args.filePath ?? args.file_path ?? args.path;
  if (f) return [String(f)];
  // apply_patch style: pull "*** Update File: x" / "*** Add File: x" lines
  const text = args.patchText ?? args.patch ?? '';
  return [...String(text).matchAll(/\*\*\* (?:Update|Add) File: (.+)/g)].map((m) => m[1].trim());
}

export function createLoopBreaker(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const sessions = new Map();

  const state = (id) => {
    if (!sessions.has(id)) sessions.set(id, { lastSig: null, run: 0, writes: new Map(), blocks: 0 });
    return sessions.get(id);
  };

  return {
    cfg,
    /** Call when the user sends a new message: they are steering again, so start fresh. */
    resetSession(id) { sessions.delete(id); },

    /**
     * Returns { block: false } or { block: true, reason, abort }.
     * Only records the call if it is allowed.
     */
    check(id, tool, args, now = Date.now()) {
      const s = state(id);
      const sig = `${tool}|${stableStringify(args ?? {})}`;
      const run = sig === s.lastSig ? s.run + 1 : 1;

      let reason = null;
      if (run >= cfg.maxIdentical) {
        reason = `You have called "${tool}" ${run} times in a row with exactly the same arguments. ` +
          `Repeating it will give the same result as last time. If it failed, change your approach or report the problem.`;
      }

      const files = filesOf(tool, args);
      if (!reason) {
        for (const f of files) {
          const times = (s.writes.get(f) || []).filter((t) => now - t < cfg.windowMs);
          if (times.length >= cfg.maxFileWrites) {
            reason = `You have already written ${f.split('/').pop()} ${times.length} times in the last ` +
              `${Math.round(cfg.windowMs / 60000)} minutes. The file is saved; rewriting it again is a loop.`;
            break;
          }
        }
      }

      if (reason) {
        s.blocks += 1;
        const abort = s.blocks >= cfg.maxBlocks && !s.aborted;
        if (abort) s.aborted = true;
        return {
          block: true,
          abort,
          reason: `[loop-breaker] BLOCKED. ${reason} ` +
            `STOP calling tools. Reply to the user in plain text: what is finished, what is left, ` +
            `and what you were trying to do when you repeated yourself.` +
            (abort ? ' This session is being stopped because the loop continued after warnings.' : ''),
        };
      }

      s.lastSig = sig;
      s.run = run;
      for (const f of files) {
        const times = (s.writes.get(f) || []).filter((t) => now - t < cfg.windowMs);
        times.push(now);
        s.writes.set(f, times);
      }
      return { block: false };
    },
  };
}
