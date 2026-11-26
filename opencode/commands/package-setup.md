---
description: Package this OpenCode setup (config template, rules, context files, subagents, plugins, watchdog, commands) into a shareable zip on the Desktop. Pass extra folders to include, e.g. /package-setup ./agents
---
The packaging script has already run. Its output:

!`node ~/.config/opencode/scripts/package-setup.mjs $ARGUMENTS`

Report this to the user:
- If it starts with "Packaged", give the zip path, the file count, and the Checks list exactly as shown.
- If it says FAILED, show the reason exactly and explain in one sentence what they need to change.
Do not run any tools and do not try to build the zip yourself.
