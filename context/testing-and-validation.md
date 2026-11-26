# Testing & Validation

Companion to [context.md](context.md). That file covers how to plan and make changes; this
one covers how to prove a change actually works before saying so.

## The rule

**Never report a task as done based on what the code *should* do. Report it done based on
something you actually ran and observed.** "I've implemented X" and "I've implemented and
verified X" are different claims — don't collapse them into one. If you didn't run it, say
"I made the change but haven't run/verified it" — that sentence is always allowed; a false
"this works" is not.

A concrete example of the anti-pattern already in this repo: [test-api.js](test-api.js)
imports `express` and `multer`, then just `console.log`s a description of the endpoints
("Backend structure is ready for image uploads with: - POST /upload...") and exits. It never
starts a server, never sends a request, never checks a response. Running it prints reassuring
text and proves nothing. Don't write or accept this pattern — a "test" that only asserts what
the code is *supposed* to do, in prose, is not a test.

## Before claiming "done", actually do this

Pick whichever of these apply to the change:

1. **It compiles/builds.** For a frontend change: `npm start` (or `npm run build`) and check
   the terminal/browser console for errors — CRA will show a red error overlay or fail the
   build outright if something is broken. A "no errors printed" claim requires having
   actually run the command in this session, not an assumption that the syntax looks right.
2. **It runs.** For the API (`npm run api`, i.e. `src/api/imageUpload.js`): start the server
   and confirm it actually stays up (didn't crash on startup) — check the process/log output,
   not just that `node` didn't immediately throw a syntax error.
3. **It does the specific thing that was asked.** Don't stop at "it starts." If you added or
   changed an upload endpoint, actually send a request to it (e.g. `curl -F
   "file=@somefile.jpg" http://localhost:<port>/upload`) and look at the real response —
   status code and body — not the code path you *expect* it to take. If you changed a React
   component, render it (dev server + browser, or a test) and look at the actual output,
   not just re-read the JSX and reason that it "looks right."
4. **It doesn't break what already worked.** Re-check adjacent functionality you touched
   indirectly — e.g. a change to `Comp_Albums.js` should be checked against both albums it
   renders, a change to the upload destination logic should be checked against both
   `work` and `photo` directories in `imageUpload.js`.
5. **Existing automated tests still pass**, if any apply: `npm test` (CRA/Jest, e.g.
   `src/App.test.js`). If your change should have a test and doesn't, say that explicitly
   rather than silently skipping it.

If a step above isn't possible in your environment (no browser, no way to hit a live
MongoDB, no network), say exactly which check you couldn't perform and why — don't imply
full verification happened.

## What "I verified this" must include

When reporting back, be specific enough that the claim is checkable:

- The exact command(s) run.
- What the actual output/response was (not a paraphrase like "it worked" — the real status
  code, error text, or rendered result).
- What you did *not* check, if anything (e.g. "I confirmed the endpoint returns 200 with a
  valid image; I did not test the file-type rejection path").

"I tested it and it works" with no supporting detail is not sufficient — treat it as an
unverified claim until it comes with what was actually observed.

## Specific failure modes to watch for in this repo

- **Confusing "the file has no syntax errors" with "the feature works."** Multer/Express
  code in particular fails at *runtime* (wrong field name, missing directory, wrong content
  type) in ways a static read won't catch — see `fileFilter` and the `destination`/`filename`
  callbacks in `imageUpload.js`. Trigger an actual upload request to know if these paths are
  correct.
- **Assuming a directory or file exists.** `imageUpload.js` creates `src/albums/work` and
  `src/albums/photo` at upload time via `fs.mkdirSync` — if you change paths, confirm the new
  path is actually created/writable, don't just confirm the string looks right.
- **Two servers, one claim.** This project runs the CRA dev server (`npm start`, port 8000)
  and the Express API (`npm run api`) as separate processes. "I ran the app and it works"
  needs to say *which* process(es) were actually running when you checked — a frontend change
  can look fine with the API down if the affected code path never calls it.
- **less-watch-compiler output.** If you edit a `.less` source, confirm the compiled `.css`
  in `src/css/` actually changed (check the file/timestamp or the rendered page) rather than
  assuming the watcher picked it up.
- **Silent catch blocks.** If an error is swallowed (caught and only logged, or not logged at
  all), "no error was thrown" is not evidence of success — check for a caught-and-hidden
  failure before declaring the happy path proven.

## When you're not sure you can verify something

Say so, and propose how a human could verify it quickly (an exact command to run, a URL to
open, a file to check) rather than either (a) claiming success anyway or (b) leaving the
human to guess what to check.
