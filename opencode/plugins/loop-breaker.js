/**
 * loop-breaker — OpenCode plugin.
 *
 * Runs inside OpenCode but outside the model, before every tool call:
 *   - blocks the 3rd identical tool call in a row
 *   - blocks a 6th write/edit to the same file within 5 minutes
 *     (catches loops where the content changes slightly each time, which
 *     OpenCode's built-in doom_loop check misses)
 *   - after 3 blocks in one turn, aborts the session
 * Counters reset whenever you send a new message.
 * Every block is logged to <config dir>/watchdog/loop-breaker.log
 *
 * Tune via env vars: LOOP_MAX_IDENTICAL, LOOP_MAX_FILE_WRITES, LOOP_WINDOW_MIN, LOOP_MAX_BLOCKS.
 */
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoopBreaker } from '../watchdog/loop-breaker-core.mjs';

// Logs go next to the helper modules, wherever this config folder is installed.
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'watchdog');
const LOG = join(LOG_DIR, 'loop-breaker.log');
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

export const LoopBreaker = async ({ client }) => {
  const guard = createLoopBreaker({
    maxIdentical: num(process.env.LOOP_MAX_IDENTICAL, 3),
    maxFileWrites: num(process.env.LOOP_MAX_FILE_WRITES, 5),
    windowMs: num(process.env.LOOP_WINDOW_MIN, 5) * 60_000,
    maxBlocks: num(process.env.LOOP_MAX_BLOCKS, 3),
  });

  const log = (line) => {
    try { appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`); } catch {}
  };
  try {
    appendFileSync(join(LOG_DIR, 'plugins.log'),
      `[${new Date().toISOString()}] loop-breaker loaded pid=${process.pid}\n`);
  } catch {}

  return {
    'chat.message': async (input) => {
      guard.resetSession(input.sessionID);
    },

    'tool.execute.before': async (input, output) => {
      const verdict = guard.check(input.sessionID, input.tool, output.args);
      if (!verdict.block) return;

      log(`${verdict.abort ? 'ABORT' : 'BLOCK'} session=${input.sessionID} tool=${input.tool} ${verdict.reason}`);

      if (verdict.abort) {
        // Let the error reach the model first, then stop the session.
        setTimeout(() => {
          client.session.abort({ path: { id: input.sessionID } })
            .catch((e) => log(`abort failed session=${input.sessionID}: ${e?.message ?? e}`));
        }, 250);
      }
      throw new Error(verdict.reason);
    },
  };
};
