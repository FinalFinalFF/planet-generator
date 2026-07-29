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
