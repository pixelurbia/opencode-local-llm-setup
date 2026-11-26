# Working style

## Finishing a request
- Before you say a task is done, list each thing the user asked for (file format, location, name, what must be included) and check each one with a command. Report it as a checklist: ✅ met / ❌ not met.
- Do exactly what was asked. If you must change something (a different format, a missing file, a narrower scope), say so plainly. Never substitute silently.
- If the request is ambiguous ("your plugins", "the agents"), use the map below; if it is still unclear, ask one short question before starting.

## Where your own setup lives
"Your" config, subagents, plugins, commands, skills or context files means these, not files in the current project:
- Config: `~/.config/opencode/opencode.jsonc` (or `opencode.json`)
- Subagents: `~/.config/opencode/agents/*.md`
- Plugins: `~/.config/opencode/plugins/*.js`; their helper modules and the loop watchdog are in `~/.config/opencode/watchdog/`
- Commands: `~/.config/opencode/commands/*.md`; scripts they run are in `~/.config/opencode/scripts/`
- Skills: `~/.config/opencode/skills/` (if present)
- Context/rules files: this file, plus every path listed under `instructions` in the config
- Project-level additions, if any: `AGENTS.md` and `.opencode/` in the project folder
- Private, never copy, zip or share: `~/.local/share/opencode/` (holds `auth.json` credentials, the session database, logs), any `node_modules/`, `.env` files
- To package this setup for sharing, use the `/package-setup` command. It builds and checks the zip with a script; do not assemble it by hand.

## Staying out of loops
- For multi-file work, give each file to the `worker` subagent, one call per file, with: the path, what it must do, and which files to read first. Keep its one-line reply; do not re-read the file it wrote.
- Keep a short checklist in your reply and tick items off. A step is done when worker replies DONE. Never redo a done step.
- If a tool call is rejected with `[loop-breaker] BLOCKED`, stop calling tools and tell the user in plain text what is done and what is left.
- If the user asks a question mid-task, answer it before doing anything else.
- If work seems to be going in circles, call the `loop-guard` subagent once.
