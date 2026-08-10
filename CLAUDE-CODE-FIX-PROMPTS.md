# Fix Prompts — Code Review Follow-ups

Run in order. 1–3 are the real bugs; 4 is a batch of small fixes; 5 adds the
regression tests (run it last, so the tests lock in the *fixed* behavior).
After each prompt: `npm run typecheck` and a CHANGELOG entry are expected —
CLAUDE.md already tells Claude Code this, but the prompts restate the
verification step where it matters.

---

## Prompt 1 — Restore the lock/RNG invariant in remix.ts

```
There is a contradiction between CLAUDE.md and src/lib/remix.ts, and the code is
on the wrong side of it.

CLAUDE.md (and remix.ts's own header comment) state the invariant: the RNG
stream is consumed in a fixed order regardless of which sections are locked — a
locked section still runs its RNG draws and throws the result away, so toggling
one lock never shifts what an unrelated unlocked section produces for the same
seed.

The implementation short-circuits instead. In remix():
- background: `locks.background ? doc.background : (() => {…draws…})()` — the
  draws never happen when locked
- planet: the object literal containing remixGradient() and the stroke draws is
  only evaluated when unlocked
- patterns: `locks.patterns ? prevPatterns : Array.from(…)` skips all
  remixPatternLayer draws
- shading and accents: same pattern

Meanwhile rolledCount, rolledBelow, the `sliced` roll, and the slices config
draws all run unconditionally with comments saying "rolled either way to keep
the RNG stream fixed" — that is the intended style. remixGradient's lockColors
path also gets it right (draws, then discards).

Fix: in remix(), compute every section's remixed candidate unconditionally, in
the current order, then select `locks.X ? doc.X : candidate` afterward. Watch
two subtleties:
1. The pattern-layer count draw and the per-layer draws must be identical in
   both cases. When locks.patterns is true, still build `patternCount` layers'
   worth of draws and discard them. Note patternCount itself depends on
   doc.lockPatternCount and prevPatterns.length — that's fine, those are doc
   state, not lock state; keep that behavior.
2. remixShading/remixAccents only run when a prev layer exists. A doc without a
   shading layer consuming fewer draws is acceptable (layer existence is doc
   state), but locking must not change consumption. Keep the guard on layer
   existence, remove the guard on locks.

Then verify the invariant with a temporary harness (delete it after): render a
qa.html route or a node-side check that runs remix() on a fixture doc with a
fixed seed under (a) no locks, (b) locks.background only, (c) locks.shading
only — and asserts the *unlocked* sections are deep-equal across a/b/c. Also
assert same seed + same locks is byte-identical JSON.

Update the CHANGELOG with what was wrong and why the fix is draws-always.
While in there: add a short CLAUDE.md note under "Remix determinism" that
pickPalette deliberately excludes the current palette, so a Remix All seed
reproduces its palette choice only from the same starting palette — that is a
known, accepted tradeoff, not a bug to fix later.
```

## Prompt 2 — Namespace pattern-internal ids per instance, not per pattern

```
Bug: src/lib/patterns/parse.ts namespaces a pattern template's internal ids by
pattern id only (`p{id}-…`, see namespaceIds). Recoloring rewrites gradient
stop colors *inside* those defs. So when the same pattern appears twice in the
same HTML document — two pattern layers using the same patternId (remix picks
with replacement, so this happens), or the editor preview plus a BatchPanel
cell, or two batch cells — duplicate ids are injected and every url(#…)
reference document-wide resolves to the FIRST instance. The second instance
silently renders with the first one's colors. "Blue Orange Purple Bauhaus
Circle Pattern 1.svg" has 9 url(#) gradient references and makes this visible
immediately.

Fix by making instance namespacing part of recoloring:
- In parse.ts, namespace ids to a *placeholder* token (e.g. `%%ns%%-{id}`)
  instead of the pattern-id prefix, in id="", url(#…), and href="#…" alike.
- In registry.ts recolor() (or a sibling), substitute the placeholder with a
  caller-supplied namespace in the same single string pass as the color tokens.
- In PlanetSvg's PatternLayerView, pass `${prefix}-${layer.id}` as the
  namespace — prefix is the per-svg idPrefix, so this is unique across layers
  AND across the editor/batch cells.
- Check expandPatternFills in src/lib/export.ts still behaves: with unique
  per-instance ids its hoisted tile <defs> no longer collide when one export
  contains two layers of the same pattern, which fixes a latent bug there too.
  The `${id}-tile` clipPath id it mints should also stay unique — confirm.

Storage/doc compatibility: templates are parsed at load time, never persisted,
so no migration is needed — confirm nothing stores a recolored template.

Verify per CLAUDE.md's QA-route pattern: add a temporary qa.html that renders
one document with TWO layers of the Bauhaus circle pattern with clearly
different color assignments (e.g. layer 1 all red slots, layer 2 all blue),
side by side with a batch-style second <svg> using the same pattern. Screenshot
via headless Chrome and confirm the two layers actually show their own colors.
Export the SVG (expandPatterns on) and re-check the exported file in the
browser. Delete the QA route when done. CHANGELOG entry: root cause (document-
wide id resolution), the %%ns%% approach, and the export defs side-effect.
```

## Prompt 3 — Make useDoc history StrictMode-safe

```
Bug in src/state/useDoc.ts: replace() and update() mutate lastCommit.current
*inside* the setHistory updater function. React StrictMode (enabled in
main.tsx) double-invokes state updaters to surface exactly this impurity. The
first invocation records {key, now}; the second sees "same key, 0ms ago" and
takes the coalesce branch — so in dev, the first commit of a slider drag never
pushes a history entry and undo behaves differently from the production build.
This app's rule is that dev must look like prod; that applies to history.

Fix: decide coalescing *before* calling setHistory. Compute `now`, read
lastCommit.current, derive the coalesce boolean, write lastCommit.current, then
call setHistory with a pure updater that closes over the decision. Note the
update() variant runs the recipe against h.present inside the updater — keep
the recipe inside (it's pure and needs fresh state), but hoist only the
coalesce decision. The recipe's `next === h.present` early-return must still
work; when it fires, the hoisted lastCommit write has already happened — that
is acceptable (a no-op commit refreshing the coalesce window is harmless), just
leave a comment saying so.

Verify: with StrictMode on, in the dev server, drag a slider (one history
entry), pause >700ms, drag again (second entry), and confirm two undos land on
the intermediate state and then the original. Also confirm plain
non-coalesced commits (e.g. Remix) each get their own entry. CHANGELOG entry
explaining the StrictMode double-invoke mechanism so it isn't reintroduced.
```

## Prompt 4 — Small fixes batch

```
Four small fixes, one pass, individual commits or one commit with a clear
CHANGELOG entry per item:

1. Flush persistence on exit. src/state/useDoc.ts debounces saveDoc by 350ms
   and App.tsx debounces UI state by 300ms; closing the tab inside that window
   loses the last change. Add a `pagehide` (and `visibilitychange` →
   'hidden') listener that synchronously flushes the pending doc and UI saves.
   Keep the debounce for the steady state; the listener is just a flush.

2. Fully transparent color literals parse to opaque black.
   normalizeHex('transparent') returns '#00000000', then the 8-digit branch
   strips alpha → '#000000'. In pattern parsing that turns invisible source
   geometry into paintable black ink that appears after recoloring. Change
   normalizeHex to return null for fully transparent literals ('transparent'
   and any #rrggbb00 / #rgb0 with alpha 0) so they are left untouched, like
   'none'. Check call sites: parseHexList and palette import should be fine
   with null-skip, but confirm nothing relied on 'transparent' normalizing.

3. Sanitize imported pattern SVGs. Dropped files flow through
   dangerouslySetInnerHTML. innerHTML won't execute <script>, but on* event
   attributes and <foreignObject> can execute or render arbitrary HTML. In
   parsePatternSvg, strip: <script> elements, <foreignObject> elements, all
   attributes whose name starts with "on", and href/xlink:href values that
   don't start with "#" (external/javascript: refs). Do it for built-ins and
   imports alike — one code path, and it also keeps junk out of exports.

4. Batch PNG filenames: exportBatch names PNGs planetFilename(seed, 'png')
   while the single export appends the long-edge suffix. Add the same
   `${batchPngSize}` suffix in the batch path for consistency.

npm run typecheck when done. No behavior beyond the above.
```

## Prompt 5b — Deploy to GitHub Pages (run anytime; fine before Prompt 5)

```
Publish this app as a live webpage on GitHub Pages. Current state: git repo is
initialized with a sane .gitignore (node_modules, dist ignored) but has NO
remote; vite.config.ts sets no `base`.

1. Create the GitHub repo and push. Use the `gh` CLI (`gh repo create`) — ask
   me for the repo name and whether public or private before creating, and
   stop and tell me if `gh` is missing or not authenticated rather than
   guessing at credentials. NOTE for me, the user: the Patterns/, Examples/,
   and Palettes/ folders contain stock/brand assets that a public repo would
   republish; private repos need a paid GitHub plan for Pages. Surface that
   tradeoff in the question.

2. Configure Vite for a project page. In vite.config.ts set
   `base: process.env.GHPAGES_BASE ?? '/'` or simply `'/<repo-name>/'` —
   pick the simple literal unless there's a reason not to. Everything in the
   app uses bundled imports (import.meta.glob for patterns) and localStorage,
   so a base path is the only serving-related change; verify no absolute `/`
   asset URLs exist in index.html or src (check favicon/links).

3. Add .github/workflows/deploy.yml using the official Pages actions:
   on push to the default branch → npm ci → npm run build (this runs
   `tsc -b && vite build`, so type errors fail the deploy — good) →
   actions/upload-pages-artifact with dist → actions/deploy-pages. Set the
   workflow permissions (pages: write, id-token: write) and enable Pages
   with source "GitHub Actions" via `gh api` or tell me the one settings
   toggle if the API path is awkward.

4. Verify locally before pushing: `npm run build`, then `npm run preview`,
   and screenshot the preview URL with the headless-Chrome command from
   CLAUDE.md to confirm the app boots with the non-root base (asset 404s
   from a wrong base show up as a blank/unstyled page). After pushing, watch
   the Actions run with `gh run watch`, then fetch the live URL and confirm
   it renders and that Remix + SVG export work (export is all client-side,
   so it should).

5. Housekeeping: add the live URL to the README, and a CHANGELOG entry noting
   the base-path decision and that deploys are type-checked by the build.

localStorage persistence is per-origin, so anyone loading the page gets their
own documents/palettes — no backend needed; say so in the README line.
```

## Prompt 6 — Planet style: scope, locks, and the "locked planet still changes" confusion

```
Two related problems around the "Planet style" dropdown and locks. Read
applyPlanetStyle/detectPlanetStyle in src/lib/defaults.ts and the Planet
section of the sidebar first.

PROBLEM A — Planet style is a whole-composition macro wearing a section-local
name. Each style rewrites planet mode AND pattern/shading/accent visibility
("Flat disc" force-hides accents; "Shaded sphere" force-shows them). That is
the intended design, but (1) the control sits inside the Planet section and is
labeled "Planet style", so users read it as planet-scoped, and (2) it ignores
locks entirely — with Planet (or Accents, etc.) locked, applying a style still
rewrites that section, violating the "a lock is absolute" product rule in
CLAUDE.md.

Fix A:
1. Make applyPlanetStyle respect doc.locks per section: skip the planet
   rewrite when locks.planet, skip pattern-layer changes when locks.patterns,
   skip the shading rewrite when locks.shading, skip accents when
   locks.accents. Apply everything else. Return enough information (or add a
   second return value / callback) for App.tsx to toast which sections were
   left alone, e.g. "Planet style: Flat disc (accents locked — left as is)".
2. Rename the control to "Composition style" and add one line of helper text
   under it: "Rewrites planet mode, shading, and layer visibility together.
   Locked sections are left alone." Keep it in the Planet section (moving it
   would churn the UI) but the label must stop claiming planet scope.
3. Keep it one undo entry (it already goes through a single update()).
4. detectPlanetStyle stays as is.

PROBLEM B — With Planet locked, Remix All appears to change the planet. The
geometry does not actually change (verify this while you're in there), but two
things move: (1) Remix All re-rolls the palette unless COLORS is locked, and
every planet color is a palette-slot reference, so the locked planet recolors
head to toe; (2) the style dropdown reflects detectPlanetStyle, which reads
pattern/shading visibility — remixing those flips the dropdown label.

Fix B:
1. Add an assertion to the temporary lock harness from the earlier remix fix
   (or a one-off check if that's gone): remix and Remix All with locks.planet
   set → doc.planet deep-equal before/after. If that ever fails, there is a
   real leak — fix it; I believe it currently passes.
2. Communicate the colors/geometry split in the UI: the lock button tooltip
   (or the section header) for Planet/Background/Patterns/etc. should say
   locks freeze *settings and geometry*, and that colors follow the palette
   and the separate Colors lock. One sentence, shown where the lock lives.
3. Add a CLAUDE.md note under the locks section: section locks freeze the
   section's values; palette swaps still recolor locked sections because
   colors are slot references — that is the Colors lock's job. And note that
   applyPlanetStyle now respects locks (added in this change).

Verify in the dev server: lock Accents → apply Flat disc → accent rings
survive and a toast says accents were skipped; unlock → apply Flat disc →
accents hide as designed. Lock Planet → the style dropdown's planet-mode
effect is skipped but visibility changes still apply (and the toast says so).
CHANGELOG entry for both the behavior change and the naming change.
```

## Prompt 7 — Remix must preserve layer stack order for locked sections

```
Bug: remix() in src/lib/remix.ts rebuilds doc.layers in a canonical order every
time — [accents-if-below] + patterns + shading + [accents-if-above]. The
section locks preserve layer CONTENTS (prevPatterns / prevShading /
prevAccents pass through untouched) but the rebuild discards their POSITIONS.
So a user-arranged stack (shading between two patterns, an accent mid-stack)
is flattened by every Remix, even when the relevant sections are locked. The
existing locks.accents special case (accentsWereBelow) only preserves a binary
above/below-the-patterns position, not the actual slot.

The rule to implement: a locked section's layers keep their exact positions in
doc.layers. Positions may only change for unlocked sections. Concretely,
replace the rebuild with in-place substitution:

1. Start from doc.layers' existing order. Substitute remixed shading/accents
   into the same indices they already occupy. Substitute remixed pattern
   layers into the existing pattern slots in order.
2. Pattern count changes (only possible when locks.patterns is off): if the
   new count is larger, insert the extra layers immediately after the last
   existing pattern slot (or, if there were none, below the shading layer, or
   at the end); if smaller, drop the trailing pattern slots.
3. The accent above/below roll (rolledBelow) stays, and per the lock/RNG
   invariant it must still be DRAWN unconditionally — but it may only MOVE the
   accent layer when locks.accents is off. When it moves, move just the accent
   layer to the bottom or the top of the stack and leave every other layer's
   relative order alone.
4. Shading no longer gets forcibly re-seated after patterns; it keeps its slot.
   (If a doc has shading below a pattern, that was a user choice; remix
   changing its contents is fine, moving it is not.)

Interactions to keep intact:
- remixSection() inverts locks and reuses remix(), so it inherits this fix —
  verify that randomizing one section never reorders the others.
- The RNG-draw ordering fixed earlier must not regress: this change is about
  where results are PLACED, not how many draws happen.
- normalizeDoc/presets: no schema change, order is already part of doc.layers.

Extend the determinism harness/tests: with all of patterns+shading+accents
locked, remix() must return doc.layers deep-equal INCLUDING order; with only
patterns locked, pattern layers keep contents and their relative order among
themselves. Sabotage once to confirm the check bites.

Verify visually in the dev server: build a stack with an accent between two
patterns, lock accents and patterns, hit Remix and Remix All several times —
the Layers list order must not move. Unlock accents, confirm the above/below
restack still happens occasionally. CHANGELOG entry: locks now freeze stack
position as well as contents, and why the accent roll survives as a
move-only-when-unlocked selection.
```

## Prompt 8 — Diagnose and fix the UI freeze (measure first, then fix)

```
The app has become slow enough to freeze the browser for multiple seconds.
Diagnose before fixing — instrument, reproduce, and let the profile decide
which of the fixes below to apply. Do not apply all of them speculatively.

STEP 1 — Instrument. Add temporary dev-only instrumentation (strip it before
finishing): a PerformanceObserver for `longtask` logging duration + a counter;
performance.mark/measure around (a) resolveTokens+recolor per pattern layer in
PatternLayerView, (b) the BatchPanel `cells` useMemo, (c) remix(). Log DOM
node count (document.querySelectorAll('*').length) after render. Reproduce
with: slider drags on planet gradient + a layer color, Remix All spam, the
batch panel open at 5×5, and again after `npm run build && npm run preview`
(StrictMode double-render only exists in dev — report the dev/prod delta).
Also list imported patterns and their template sizes
(listImported().map(p => p.raw.length)) — a dropped 500 KB SVG explains a lot
and lives only in localStorage, not the repo.

STEP 2 — Fix what the profile implicates, in this order of likelihood:

A. Recolor/innerHTML churn. Every PlanetSvg render re-runs resolveTokens +
   recolor for every pattern layer (templates run up to ~330 KB), and any
   change in the produced string makes the browser re-parse that entire SVG
   subtree via dangerouslySetInnerHTML. During a color/opacity slider drag
   that is per-frame. Fix: memoize the markup per layer with useMemo keyed on
   (parsed, layer.colors, layer.blend if it feeds colors, namespace), and
   split PatternLayerView into a React.memo component so unrelated doc edits
   (planet gradient, shading) don't recompute pattern markup at all. Cache
   resolveTokens output on the ParsedPattern per colors-JSON key if the
   profile still shows recolor time. This must not change output — same
   string, computed less often. The single-<svg>-source-of-truth invariant is
   untouched by memoization.

B. Batch panel cost. 9–25 full-fidelity PlanetSvg cells recompute and
   re-render on every doc/palette change while open, and the panel toggles on
   the bare "B" key so it may be open by accident. Fixes: (1) memoize cells
   per (batchSeed, cols, varyPalette, doc, palettes) — already a useMemo, but
   verify the doc identity isn't churning per keystroke via transient updates;
   (2) render cells lazily with content-visibility: auto or an
   IntersectionObserver; (3) pause cell re-render entirely while the main doc
   is mid-drag. DO NOT degrade cell rendering fidelity (fewer conic segments,
   simplified patterns): batch export serializes those live nodes, and cells
   must stay byte-identical to a promoted-then-exported document.

C. Import weight. If a very large imported pattern is implicated, add a
   parse-time complexity note (element count) and warn on import when a file
   exceeds ~150 KB or ~2000 elements, suggesting the user simplify it. Do not
   auto-simplify.

D. If long tasks trace to blend-mode compositing (many mix-blend-mode layers
   over a large stage), reduce the *stage display* cost only: cap the
   on-screen preview element size (CSS width/height of the host, not the SVG's
   own width/height attributes or viewBox, which exports read). Verify
   exported SVG/PNG are unchanged afterward.

STEP 3 — Prove it. Before/after numbers for the same reproduction script:
longtask count and worst duration for a 5-second slider drag, with and without
the batch panel open, dev and prod. Screenshot the app via the headless-Chrome
recipe to confirm nothing visual changed, and run npm test. Remove the
instrumentation, or keep it behind `import.meta.env.DEV` if it earned its
place. CHANGELOG entry: what the profile actually showed (name the culprit),
what was fixed, and the before/after numbers.
```

## Prompt 9 — Flat mode: a persistent "no 3D shading" switch

```
Add a document-level "Flat mode" toggle: when on, nothing renders that creates
the illusion of a 3D sphere, while everything genuinely graphic stays —
linear/radial/conic gradients, patterns, rings, satellites, background,
vignette. This is different from the "Flat disc" composition style, which is a
one-shot macro that also hides patterns and accents. Flat mode is a standing
constraint that coexists with any style and any remix.

What counts as a depth cue (suppressed when flat):
- the shading layer entirely: terminator shadow, highlight, contact shadow
- the accent layer's RIM LIGHT (the crescent along the lit limb) — it lives in
  Accents but it is a 3D cue; rings and satellites are graphic and stay
- nothing else: gradients of any type are fine, vignette stays (it's a
  background treatment, not sphere shading — note this choice in the code)

Model: add `flat: boolean` to PlanetDoc. Default false; add it to normalizeDoc
so old docs and presets load. It is not a lock — keep it out of doc.locks.

Renderer (PlanetSvg): when doc.flat, skip ShadingLayerView and skip the rim
crescent (but still render the accent layer's rings/satellites). Suppress at
render, don't mutate layer data — the user's shading settings must survive
toggling flat off. The layer still exports correctly because export serializes
the live SVG, which simply doesn't contain the suppressed nodes.

Remix: flat mode must hold across Remix/Remix All. Per the RNG invariant, do
NOT skip any draws — remixShading and the rim draws still run; apply flat as a
pure selection afterward (shading candidate kept but it renders suppressed
anyway; rim.enabled forced false in the *rendered* output is already handled
by the renderer, so remix needs no special casing at all if suppression is
render-side only — verify that conclusion and prefer it, since it keeps one
mechanism). Same for applyPlanetStyle: styles may set shading visible: true;
that's fine, flat just outranks it at render time.

UI:
- A "Flat mode" toggle placed in the Shading section header area (visible even
  when the section is collapsed) or next to Composition style — pick whichever
  reads better in the existing chrome, keep it one control.
- When flat is on, show the shading section's controls disabled with a one-line
  note ("Flat mode — shading suppressed"), and the rim controls likewise. Same
  pattern the locks use for inert controls.
- detectPlanetStyle: when doc.flat, a doc whose only difference from
  'shaded-sphere' is suppressed shading should NOT report shaded-sphere; take
  flat into account (simplest: treat shading as invisible in the detector when
  flat).

Tests: extend the remix suite — with flat on, remix N seeds and assert the
rendered doc still has flat true and that toggling flat is the only change
needed to restore shading (layer data untouched). Keyboard: no new shortcut.

Verify in the dev server: build a shaded planet with rim + rings, toggle Flat
mode → terminator/highlight/rim disappear, rings/satellites/patterns/gradients
stay; Remix All several times → nothing shaded comes back; toggle off →
original shading returns exactly. Export SVG+PNG in flat mode and confirm the
files contain no shading/rim geometry. CHANGELOG entry: what counts as a depth
cue and why suppression is render-side rather than data mutation.
```

## Prompt 5 — Add a minimal regression test harness (run last)

```
This repo has no test framework by design ("correctness means it looks right"),
but two contracts are invisible to visual inspection and have already regressed
once: remix determinism and the pattern parse output. Add the smallest possible
vitest setup to lock them — this is a deliberate, scoped exception; do not grow
it into a general test suite.

Setup: vitest as a devDependency, `npm test` script, node environment. The
parse pipeline uses DOMParser/XMLSerializer, so run those tests in vitest's
jsdom (or happy-dom) environment; keep remix tests pure-node.

Tests:
1. remix determinism: a checked-in fixture doc + fixture ParsedPattern list
   (hand-build two tiny fake ParsedPatterns; do not read real pattern files).
   Assert:
   a. remix(doc, 'seed-1', deps) twice → identical JSON
   b. unlocked sections are deep-equal across runs where only an unrelated
      lock differs (the invariant from the earlier lock fix): compare
      no-locks vs locks.background vs locks.shading
   c. a locked section is byte-identical to its input (lock is absolute),
      for remix, remixSection on other sections, and shuffleColors with
      locks.colors
2. parse snapshot: parsePatternSvg on a small inline SVG string fixture
   covering: a full-bleed background rect, a gradient def with stop-color
   (tokenized), a mask subtree (NOT tokenized), an id that must be namespaced
   to the %%ns%% placeholder, and a style="fill:…" attribute. Snapshot the
   ParsedPattern (template + groups).
3. zip smoke: createZip round-trip — parse the produced bytes' EOCD and local
   headers and verify counts, sizes, and CRCs for two small entries (pure
   byte-level check, no unzip binary).

Add `npm test` next to typecheck in the CLAUDE.md Commands section, with one
line saying what the suite is for and that it stays minimal. CHANGELOG entry
covering why the exception exists.
```
