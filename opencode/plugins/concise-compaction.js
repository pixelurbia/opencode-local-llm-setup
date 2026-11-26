/**
 * concise-compaction — OpenCode plugin.
 *
 * When OpenCode compacts (summarizes) a long session, this:
 *   1. replaces the long default summary template with a short 5-section one
 *      (Goal / Done / Not done / Next step / Open questions), and
 *   2. adds a VERIFIED LEDGER built from real tool results and a disk check,
 *      so the summary can't claim a finished file is still to do (the bug that
 *      made Gemma rewrite generic.js 150+ times).
 * If anything goes wrong it falls back to OpenCode's default behaviour.
 * Ledgers are logged to <config dir>/watchdog/compaction.log
 */
import { statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPACTION_PROMPT, buildLedger, formatLedger } from '../watchdog/compaction-core.mjs';

// Logs go next to the helper modules, wherever this config folder is installed.
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'watchdog');
const LOG = join(LOG_DIR, 'compaction.log');

const stat = (p) => {
  try { return { size: statSync(p).size }; } catch { return null; }
};

export const ConciseCompaction = async ({ client, worktree, directory }) => {
  try {
    appendFileSync(join(LOG_DIR, 'plugins.log'),
      `[${new Date().toISOString()}] concise-compaction loaded pid=${process.pid}\n`);
  } catch {}
  return {
    'experimental.session.compacting': async (input, output) => {
      try {
        const res = await client.session.messages({ path: { id: input.sessionID } });
        const messages = res?.data ?? res ?? [];
        const ledger = buildLedger(Array.isArray(messages) ? messages : [], { root: worktree || directory });
        const facts = formatLedger(ledger, stat);
        output.prompt = COMPACTION_PROMPT;
        output.context.push(facts);
        try { appendFileSync(LOG, `[${new Date().toISOString()}] session=${input.sessionID}\n${facts}\n\n`); } catch {}
      } catch (e) {
        // Leave OpenCode's default prompt untouched if we can't build the ledger.
        try { appendFileSync(LOG, `[${new Date().toISOString()}] session=${input.sessionID} ledger failed: ${e?.message ?? e}\n`); } catch {}
      }
    },
  };
};
