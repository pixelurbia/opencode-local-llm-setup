# Context for AI-Assisted Development

This file is for any LLM (local or hosted) working in this repo. It sets the working
principles for how to make changes, how to research before acting, and how to communicate
with the human maintainer. Read this before touching code.

## Project snapshot

- **pbs** ("pixelbear") — a Create React App (react-scripts 5, React 19) personal/portfolio
  site with a photo/album gallery.
- `src/components/` — page and UI components (`Albums.js`, `AlbumsPage.js`, `Comp_*.js`
  presentational pieces, `BearAdmin.js` admin view, `Upload.js` upload UI).
- `src/api/imageUpload.js` — a small Express server (run via `npm run api`) handling image
  upload/processing, separate from the CRA dev server (`npm start`, port 8000 per
  `package.json`).
- Data layer: MongoDB via `mongoose` (see `mongonodetest.js` for a reference/scratch example).
- Styling: hand-written CSS in `src/css/`, plus `less-watch-compiler` running alongside the
  dev server (see the `start` script) — check whether a `.less` source exists before editing
  a compiled `.css` file directly.
- No test suite is actively maintained beyond the CRA default (`npm test`); don't assume
  coverage exists for a change just because `react-scripts test` is wired up.

This snapshot will drift — treat it as a starting orientation, not ground truth. Confirm
against the actual files before relying on specifics (script names, ports, dependency
versions).

## Core principles

1. **Read before you write.** Open the actual file(s) you're about to change and any code
   that calls into them. Don't edit from a summary or from memory of "how this component
   probably works."
2. **Match the existing style.** This codebase mixes older patterns (jQuery, class-ish
   component naming like `Comp_*`) with modern React. Follow the convention already used in
   the file you're editing rather than introducing a new pattern unasked.
3. **Smallest correct diff.** Change what the task requires. Don't refactor, rename, or
   "clean up" adjacent code in the same pass unless asked — call it out as a suggestion
   instead.
4. **Never invent an API.** If you're not certain a library function, prop, or config key
   exists and does what you think, check the installed version's docs/source (see Research
   below) instead of guessing.
5. **State assumptions out loud.** If a request is ambiguous (which component, which env,
   whether the Express API or the CRA app is in scope), say what you assumed or ask —
   don't silently pick one.
6. **Verify, don't just claim.** After a change, actually run/build/lint it when feasible
   before saying it works. If you can't verify (no way to run it), say so explicitly instead
   of implying it was tested.
7. **Secrets and destructive ops are out of bounds.** Never commit credentials, DB
   connection strings, or API keys. Don't run destructive git commands (force-push, hard
   reset, history rewrite) or delete data without explicit confirmation.

## Propose before you implement

This is the most important workflow rule. Before making a nontrivial change:

- **Lay out the approach first** — what you'll touch, why, and any real trade-off (e.g.
  "this could go in `Comp_Albums.js` or a new hook; the hook is more reusable but adds a
  file"). Keep it short: a few sentences or a short list, not a design doc.
- **Flag anything risky or hard to reverse** before doing it: schema/DB changes, deleting
  files, changing the upload/storage flow in `imageUpload.js`, editing `package.json`
  dependencies or scripts, touching build/deploy config.
- **Wait for a go-ahead on anything ambiguous or consequential.** Trivial, obviously-in-scope
  fixes (typo, clear bug with one fix, a change the user just described in detail) don't
  need a round trip — use judgment, but default to asking when unsure.
- **Offer options when there's a real choice**, with a recommendation and why, rather than
  silently picking one or listing possibilities with no opinion. "I'd do X because Y; the
  alternative is Z if you want [trade-off]" is more useful than either a bare list or a
  silent decision.
- **After the change, say what you actually did** — files touched, anything you deliberately
  left out of scope, anything you weren't able to verify.

## Doing your own research

Don't guess when you can check. Prefer, in order:

1. **The codebase itself.** Search for existing usage of a library/pattern in this repo
   before introducing a new one — an existing convention (even an imperfect one) usually
   beats a fresh import for a one-off need.
2. **Installed versions, not assumed ones.** Check `package.json`/`package-lock.json` for the
   actual installed version of a dependency before relying on its API — behavior differs
   across major versions (this repo is already mixing quite old packages, e.g.
   `react-scripts`/CRA-era tooling, with React 19; APIs that changed between those matter).
3. **Official docs for the installed version specifically**, not the latest version's docs,
   when they differ (React 19 vs. an older React idiom still present in this codebase is a
   likely source of mismatch).
4. **Primary sources over secondhand summaries** — a library's own README/CHANGELOG/type
   defs over a blog post or forum answer, when both are available.
5. **When research tools aren't available or are inconclusive**, say so plainly and describe
   the uncertainty rather than presenting a guess as verified fact.

Cross-check anything that could be version-sensitive, deprecated, or security-relevant
(auth, file upload, DB queries) even if you're fairly confident — this repo runs a live
image-upload endpoint, and correctness there matters more than in a purely presentational
component.

## Communication

- Be concise. Lead with the answer/change, not a restatement of the request.
- Use plain language over jargon; explain a term the first time it matters.
- When something is uncertain, say so — don't round uncertainty up to confidence.
- When a task turned out to be bigger or riskier than it looked, say that instead of quietly
  doing less (or more) than asked.
