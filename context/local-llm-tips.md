# Getting Better Output from a Local LLM (e.g. Qwen3) on This Project

Companion to [context.md](context.md) and [testing-and-validation.md](testing-and-validation.md).
This one is about *how to prompt and steer* a local model so it actually finishes
multi-file features, based on a real example: the admin image-upload feature it built
(`Upload.js` + `imageUpload.js` + `BearAdmin.js`) had every individual piece written
reasonably, but the pieces didn't agree with each other — wrong port in one fetch call,
a route never added, a static-file path miscalculated, a login page that isn't wired to
anything. That's the failure mode to design around: **correct in isolation, broken at the
seams.**

## Why this happens

Smaller/local models tend to generate each file as its own self-contained unit, using
plausible-looking values (a port number, a relative path, a route name) instead of
checking what the *rest of the project already uses*. They also tend to declare success
right after producing code that compiles, without tracing whether it's actually reachable
or consistent with other files. Neither is a capability limit you can't work around — it's
mostly about what you ask for and in what order.

## Prompting strategies that help

1. **Ask it to grep/read before it invents a value.** Before generating a new fetch URL,
   port, or path, have it state what port/URL the *existing* code already uses for the same
   purpose, and reuse that — don't let it pick a new one from scratch. In this repo, the
   upload endpoint already existed on `localhost:8001`; the bug was a *second* file inventing
   `localhost:8000` instead of checking the first one.
2. **Ask for the end-to-end plan before code**, specifically listing every file that needs to
   change for the feature to be *reachable*, not just written:
   - the new component/module itself
   - the route/registration that makes it reachable (a `<Route>`, an export added to an
     index, a menu entry)
   - anything that calls it, and anything it calls
   - config values (ports, URLs, paths) it must agree with elsewhere
   A prompt like "list every file you'll touch and why, including anything needed to make
   this reachable from the UI/nav, before writing code" catches "forgot to add the route"
   before it happens instead of after.
3. **Break "build a feature" into ordered subtasks** rather than one big prompt:
   backend endpoint → frontend call → wiring it into routing/navigation →
   error/loading states → a final trace-through pass. One-shot "build me an admin upload
   feature with an API" is exactly the kind of prompt that produces disconnected pieces.
4. **After it says done, make it trace the user path, not just list files.** Ask literally:
   "Walk through what happens, file by file, when a user clicks 'Upload' in the nav." If it
   can't name the route that renders the component, the gap surfaces immediately — this is
   how the missing `<Route>` and the 8000-vs-8001 mismatch would have been caught before you
   ever opened a browser.
5. **Force a self-review pass with a checklist**, not just "are you sure?" (which models
   reflexively answer yes to). Something like:
   > Before you say this is done, check each of these and report pass/fail for each:
   > - Every new route is actually added to the router, and there's a way to navigate to it.
   > - Every URL/port a frontend file calls matches where the backend actually listens —
   >   quote both sides.
   > - Every file path built with `__dirname`/`path.join` — show the resolved absolute path,
   >   don't just eyeball it.
   > - No leftover debug output, placeholder text, or hardcoded credentials made it into
   >   rendered UI or committed code.
   > - No orphaned duplicate file was left behind from an earlier attempt (check for a
   >   similar file that's no longer imported anywhere).
   This is the single highest-leverage change: an explicit, itemized checklist beats a
   generic "double-check your work," which local models tend to satisfy with a rephrase
   rather than an actual check.
6. **Have it verify paths by computation, not intuition**, especially `path.join(__dirname, ...)`
   across sibling/parent directories — this is exactly where the static-file bug happened
   (`../src/albums` from a file already inside `src/api` resolves to `src/src/albums`, not
   `src/albums`). Ask it to write out the resolved absolute path as a comment or log line
   during development, or to prefer a single shared constant for a directory path instead of
   recomputing relative paths in multiple places.
7. **Keep features in one working session/context when possible.** If `Upload.js` and
   `imageUpload.js` and `AlbumsPage.js` were generated in separate prompts/sessions without
   the model re-reading the others first, drift like the port mismatch is likely — tell it to
   re-read the files it's integrating with immediately before generating the new one, every
   time, rather than relying on it remembering an earlier turn.
8. **Ask it to remove scaffolding before calling something done.** Debug `console.log`s are
   fine to leave, but debug output rendered *into the UI* (like a `<p>` tag that prints the
   literal hardcoded password check) or hardcoded credentials should be caught by a direct
   "check for anything you'd be embarrassed to ship" pass — cheap to ask for, easy to miss
   otherwise.

## Framing the initial request

For a multi-file feature, a prompt that front-loads the integration points tends to do much
better than a short feature description. Compare:

- Weak: "Add an admin image upload feature with an API."
- Better: "Add an admin image upload feature. It needs: (1) an upload UI component, (2) an
  API endpoint it posts to, (3) a route so the UI is reachable from the existing nav link at
  `Comp_Header.js`, (4) the album-display page updated to pull from the *same* API/port the
  upload posts to — check `Upload.js` and `imageUpload.js` for the actual port before writing
  the fetch. When you're done, trace the full click-to-display path and confirm each hop
  actually connects."

The second version doesn't require more capability from the model — it just removes the
guesswork that produced the port mismatch and the missing route.

## When it says "done"

Don't take "done" as a synonym for "reachable and correct." Use
[testing-and-validation.md](testing-and-validation.md)'s verification steps yourself, or ask
the model to run them and paste real output (a `curl` response, the actual resolved
`__dirname` path, the router's registered paths) rather than a description of what it expects
to happen.
