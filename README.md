# OpenCode setup: loop protection, worker subagents and shared rules

A drop-in OpenCode configuration tuned for local models (LM Studio, Ollama, llama.cpp and so on),
which tend to loop, lose track of finished work, or quietly change what you asked for.

## What's inside

| Folder | What it is |
|---|---|
| `opencode/opencode.template.jsonc` | Config: model context limit, auto-compaction, loop denial, step cap. The installer fills in your model server address. |
| `opencode/delegation.md` | Rules loaded into every session: check each requirement before saying "done", where the setup lives, how to avoid loops. |
| `opencode/agents/` | `worker` (builds one file, checks it, one-line report) and `loop-guard` (diagnoses stuck sessions). |
| `opencode/plugins/` | `loop-breaker` blocks repeated tool calls and file-rewrite loops before they run. `concise-compaction` gives short, fact-checked summaries when a session gets long. |
| `opencode/watchdog/` | Helper modules for the plugins, plus `loop-watchdog.js`, which alerts you when a session is stuck. |
| `opencode/commands/` + `scripts/` | `/package-setup` rebuilds this zip from your own setup, with privacy checks. |
| `context/` | Extra rules/context files from the original setup. Edit or delete them freely. |
| `project/` (if present) | Example project files. See `project/DEPENDENCIES.md`. |

## Install

Requires [OpenCode](https://opencode.ai) and Node 18+ (Node 22.5+ for the watchdog).

```bash
node install.mjs
```

It asks for your model server URL (default `http://localhost:1234/v1`). Other options:

```bash
node install.mjs --base-url http://localhost:11434/v1 --watchdog
```

- `--watchdog` starts the loop watchdog at login (LaunchAgent on macOS, systemd user service on Linux, Task Scheduler on Windows).
- `--dry-run` shows what would change without changing anything.
- `--config-dir <dir>` installs somewhere other than `~/.config/opencode`.

Anything the installer would overwrite is backed up to `~/.config/opencode/backup-<date>/` first.
If you already have an `opencode.json`/`opencode.jsonc`, it is **not** replaced; the new settings are
written to `opencode.setup.jsonc` for you to merge.

Then fully quit and reopen OpenCode, type `@` in a new session, and check that `worker` and `loop-guard` appear.

## After installing, adjust to your model
In `opencode.jsonc`:
- `provider.*.models`: rename the model to match the id your server uses.
- `limit.context`: set it to your model's real context length (as configured in your server). This is what makes compaction happen before the model's memory overflows.

## Tuning
Environment variables, all optional:

| Variable | Default | Effect |
|---|---|---|
| `LOOP_MAX_IDENTICAL` | 3 | Block the Nth identical tool call in a row |
| `LOOP_MAX_FILE_WRITES` | 5 | Writes allowed to one file per window |
| `LOOP_WINDOW_MIN` | 5 | Window for the rule above (minutes) |
| `LOOP_MAX_BLOCKS` | 3 | Blocks in one turn before the session is stopped |
| `REPEAT_THRESHOLD` / `CHURN_THRESHOLD` / `WINDOW_MIN` | 4 / 6 / 10 | Watchdog alert thresholds |
| `OC_DB` | auto | Path to OpenCode's `opencode.db` if the watchdog can't find it |

Logs are written to `~/.config/opencode/watchdog/`.

## Windows notes
Commands and subagents call `node ~/.config/opencode/...`. This works in OpenCode's bash tool
(Git Bash/WSL). If your shell doesn't expand `~`, replace it with your full config path in
`agents/loop-guard.md` and `commands/package-setup.md`.

## Uninstall
Delete the files listed above from `~/.config/opencode`, and the watchdog autostart:
- macOS: `launchctl bootout gui/$(id -u)/opencode.loop-watchdog`, then delete `~/Library/LaunchAgents/opencode.loop-watchdog.plist`
- Linux: `systemctl --user disable --now opencode-loop-watchdog`
- Windows: `schtasks /Delete /TN OpenCodeLoopWatchdog /F`

## License

[MIT](LICENSE)
