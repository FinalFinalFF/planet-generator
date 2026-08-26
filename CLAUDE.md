# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Vite dev server on :5173
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -b --noEmit
npm test            # vitest run — three contracts that visual QA cannot see
```

`tsconfig.json` sets `noUnusedLocals`/`noUnusedParameters`, so an unused import
fails the build, not just lint. There is no linter.

`npm test` is a **deliberately minimal** suite covering only the contracts that
are invisible to looking at the screen and have each already regressed: remix
determinism plus lock absoluteness, pattern parse output, and the hand-rolled ZIP
writer's byte layout. Keep it that way — everything else in this app is verified by
looking at it (see below). Do not grow this into a general test suite.

The site lives at the custom domain **https://orbs.fnfn.us/** — a Cloudflare
CNAME (DNS-only, so GitHub manages the TLS cert) onto `finalfinalff.github.io`,
plus `public/CNAME` and the Pages custom-domain setting. `base` is therefore `/`;
the dev server serves from the root and a QA route lives at
`http://localhost:5173/qa.html`.

The repo is still `FinalFinalFF/planet-generator` (the app is the Orb generator;
the slug predates the rename), and the old
`finalfinalff.github.io/planet-generator/` URL redirects to the domain. `base`
and the custom domain are a pair: if the domain is ever removed, `base` must go
back to `/planet-generator/` in the same change — getting this wrong 404s every
asset on the live site.

**Pushing to `main` deploys** — a GitHub Actions workflow runs `npm run build`
and publishes to GitHub Pages, so a type error blocks the deploy rather than
shipping a broken page. `Examples/`, `Palettes/` and `Frame 468.png` are
deliberately untracked (third-party posters and brand boards in a public repo —
see `.gitignore`); never force-add them.

### Keep CHANGELOG.md current

`CHANGELOG.md` is a **decision log**, not a commit summary. After substantive
work, add an entry under `## Unreleased` covering the reasoning: why an approach
was chosen, what was tried and abandoned, how a bug was found. Record reversals
and dead ends too — the point is that a later session does not re-litigate a
settled choice or re-introduce a fixed bug. Skip it for trivial edits.

### Verifying changes

Almost nothing here is unit-testable — this is a visual tool, and correctness
mostly means "it looks right and the export matches the preview". `npm test` covers
the three exceptions listed above; everything else is verified by driving Chrome.
The `mcp__claude-in-chrome__*` tools are not connected on this machine, so use the
CLI:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1680,1000 --virtual-time-budget=12000 \
  --screenshot=/tmp/out.png http://localhost:5173/
```

`--virtual-time-budget` (ms) is the only way to wait for async work.
`--dump-dom` prints the settled DOM, which is how you get generated data out of
the page — render it into a `<textarea>` and parse it out of the dump.

For anything touching rendering, remix, or the pattern pipeline, add a temporary
QA route (an extra `qa.html` + `src/qa.tsx` entry; Vite picks up new HTML entries
automatically) that renders a grid of variants, screenshot it once, then **delete
the route before finishing**. Useful modes: an N-up remix grid across seeds and
palettes, a contact sheet of all patterns, and a
live-preview / exported-SVG / rasterized-PNG triptych for export parity.

## Architecture

### The one invariant: a single `<svg>` is the source of truth

`src/render/OrbSvg.tsx` renders the entire artwork as inline SVG.
`serializeSvg()` in `src/lib/export.ts` clones **that live DOM node** and
serializes it — SVG export is not a re-render. PNG export rasterizes the same
serialized string through an `<img>` and canvas.

This forbids a whole class of otherwise-reasonable changes:

- **No CSS that only exists in the editor.** Anything visual must be SVG
  attributes or inline `style` on SVG elements. A stylesheet rule targeting
  artwork would render in the preview and vanish from the export.
- **No `conic-gradient`.** SVG has no conic gradient. `ConicSweep` approximates
  it with N wedge paths (`gradient.segments`) whose fills are interpolated in
  OKLab, with a sub-degree overlap to hide anti-aliased seams. Its radius is the
  distance to the **farthest box corner from the focus**, not the box diagonal —
  the focus moves off-center, so the diagonal under-covers.
- **Blend modes are inline `mix-blend-mode`**, which survives serialization.
- **`expandPatterns` is the one sanctioned exception** to pure serialization.
  Tiled patterns paint as `<rect fill="url(#pat)">`, which is valid SVG and
  renders in browsers, but design-tool importers commonly ignore `<pattern>`
  fills — Figma drops them, so the SVG loses its texture while the PNG of the
  same document keeps it. `expandPatternFills()` rewrites the fill into explicit
  tiles on the *clone*: mechanical and equivalence-preserving, verified
  pixel-equivalent apart from 1px of edge antialiasing. Two traps if you touch
  it: hoist the tile's `<defs>` once (cloning per tile duplicates ids, and only
  the first duplicate resolves), and clip each tile to its cell (`<pattern>`
  clips tile content implicitly, and several source patterns overhang their
  viewBox). PNG export passes `expandPatterns: false` — the rasterizer tiles
  correctly and expanding only bloats the intermediate string.
- **`data-role="background"`** marks the background group so the transparent
  export can drop it wholesale. **`data-name`** marks logical layers
  (`Background`, `Orb disc`, `Sector B1 <texture>`, `Pattern <name>`, `Ring`…):
  `serializeSvg` turns each into an `id` on the clone (NCName-sanitized,
  deduplicated), because design tools — Figma included — read `id` as the layer
  name on import, and an unnamed export lands as "Group/Vector" soup.
  `serializeSvg` then strips all `data-*`.

Shading is the subtle case: its children each carry their own
`mix-blend-mode` and their own opacity, and the wrapping `<g>` deliberately has
**no `opacity` attribute**. Group opacity would isolate the group and stop the
terminator shadow from multiplying against the orb beneath it.

### Orb types (v4, mode-first)

`doc.orbType` is `color` (flat-or-gradient disc), `pattern` (base fill plus 1–2
pattern layers), or `segments` (the chord-split collage). It replaced the old
`orb.mode` at DOC_VERSION 4, and the editor's whole Orb section keys off it —
each type's panel shows only what that type can use.

**The `sliced` mode is retired** (2026-08-25 product decision): no type chip, no
remix dealing, renderer and `SliceConfig` deleted. `normalizeDoc` migrates a
sliced document to `color`, keeping its gradient — its banded lattice is gone,
and that look-change was accepted and release-noted. Do not resurrect it
casually; the git history has the implementation if it is ever truly wanted.

`applyOrbType` in `lib/defaults.ts` is the type-switch engine: it rewrites
`orbType` and pattern-layer *visibility* together and nothing else — shading and
accents are orthogonal to type, hidden layers keep their data so switching back
restores them, and it respects `locks.orb`, the `orb.type` sub-lock, and
`locks.patterns`, reporting what it skipped. A "flat color" disc is a two-stop
constant gradient (`isFlatFill` in `Sidebar.tsx`) — one render path, no second
fill model.

### Segments (the sector collage)

The `segments` type renders the collage from the 2026-08-25 client comps: one chord splits the
disc into two rows, each row splits crosswise into 1–3 equal cells, each cell
filled independently (`flat` ink, 2-stop `ramp`, or `texture`). Load-bearing:

- **Cell geometry is derived** — even splits; only the chord's angle and offset
  are authored. Same philosophy as the slices' derived radii.
- **Never nest clip paths.** Chrome mis-rasterizes nested clip intersections
  when the host `<svg>` is CSS-scaled — which is how the editor stage, batch
  cells, and thumbnails all render (correct standalone, broken scaled; see
  CHANGELOG). Flat/ramp cells are pre-rotated rect *paths* under the single orb
  clip (`rotatedRectPath`); texture cells clip their inlined markup with one
  clipPath holding the exact cell∩circle path (`circleRectIntersectionPath` —
  the rotation is about the circle's center, so the circle is invariant and the
  intersection computes in the unrotated frame).
- **Texture cells never paint via `<pattern>`** — `expandPatternFills` only
  rewrites `rect` fills, so a pattern-filled `<path>` would silently lose its
  texture in Figma. They inline the recolored markup cover-fit instead, which
  is export-safe by construction.
- **Ramps span the orb's box, not the cell**, so adjacent ramp cells read as one
  composition; ramp angle is absolute and ignores the structure's rotation.
- **Accents are decoupled from orb type** (2026-08-25 decision, reversing the
  earlier anti-astronomy retirement rule): remix re-deals them unless locked,
  whatever the type. Switching to `segments` via `applyOrbType` hides pattern
  layers but never touches shading or accents — and never `doc.flat` (nothing
  but the user writes a standing constraint).

### Procedural textures

`src/lib/patterns/textures/` (rings, rules, dither, steps) generate SVG
*strings* that register as ordinary `PatternSource`s (`procedural.ts`,
registered by `registry.ts` at import). That is the whole design: because they
go through the same parse → recolor pipeline as `Patterns/` files, they get
palette mapping, pattern layers, sector texture cells, and remix reach with no
special cases. Their contract: 400×400 viewBox, full-bleed `#0A0A0A` plate
first (detected and hidden as the Plate group), one light ink hex, only plain
drawable elements, deterministic (`makeRng(seed)` for the stochastic ones),
dither/steps tile seamlessly. Ids start `tx-` — remix's sector dealing prefers
that pool (`dealFill` in `remix.ts`).

### Pattern layer masks

`layer.mask` restricts where a pattern paints: `orb`, `lens` (intersection with
an offset circle) or `outside-lens`, with a `feather`. Implemented as an SVG
`<mask>` rather than nested clip paths, because one mechanism then covers all
three cases plus the soft edge. Masks are luminance-based, so the feather
gradient's stop colors invert between `lens` and `outside-lens`.

### The lock tree and the Simple/Advanced tier

Locks come in three levels, all absolute (see Remix determinism below):

- **Section locks** (`doc.locks`) — unchanged: colors, orb, patterns, shading,
  accents, background.
- **Sub-locks** (`doc.subLocks`) — one user-meaningful property each:
  `orb.type`, `orb.size`, `orb.position` (cx+cy as one), `orb.structure`
  (chord + both row counts), `patterns.count` (absorbed the old
  `lockPatternCount` field at v4), `colors.palette` (Remix All keeps the
  palette, still re-deals assignments — applied in `App.doRemixAll`).
- **Property locks on objects** — `layer.locks` (pattern/color/scale/position/
  rotation) and each `SectorFill`'s `locks` (fill/color/scale/rotation). They
  live on the objects so identity travels through reorder and duplicate
  (duplicating a locked layer copies its locks, deliberately).

**Existence implication** is the rule that makes per-object locks coherent:
*a lock on a child implies the lock that guarantees the child's existence.*
Any locked cell pins the sector structure; any locked layer pins the pattern
count. Implications are **derived at remix time** (`structureLockedFor`,
`patternCountLockedFor` in `remix.ts`), never stored — so no un-toggle
bookkeeping can drift. The UI renders implied locks as dimmed padlocks.

Vocabulary is deliberately short — the admission test is "would a user say
this sentence?" ("lock the size", "keep it segments"), not "is this a field?".
Do not grow it one field at a time.

Advanced disclosure is **per scope, not app-wide** (a global Simple/Advanced
mode shipped briefly and was rejected in review the same day): every section
and every card (a segment cell, a pattern layer) carries its own "more
settings" toggle (`MoreToggle` + nested `TierContext` scopes in
`controls.tsx`) beside its lock, revealing only that scope's deep controls in
place. A card inherits an opened parent scope (`parent || own`), so the wider
toggle never closes a card back down. Disclosure state is ephemeral component
state, deliberately unpersisted. Two primitive-level rules do most of the
tiering: `ColorRefEditor` shows only the slot strip in a simple scope (hex
override + alpha are advanced; a fully transparent ink announces itself with a
one-tap "show"), and `GradientEditor` hides per-stop editing. When an
advanced-only value visibly affects the render (a mask, a non-normal blend),
the simple scope shows a passive note — hidden state that changes pixels must
never be invisible.

### Flat mode

`doc.flat` suppresses every 3D cue: the shading layer entirely, plus the accent
layer's crescent rim light. Gradients, patterns, rings, satellites, background and
the vignette all stay — the vignette because it is a canvas treatment that would
look the same behind a square.

Two properties are load-bearing:

- **Suppression is render-side only.** `OrbSvg` skips `ShadingLayerView` and the
  rim crescent (with its gradient def, so no dead markup reaches the export);
  nothing rewrites layer data. That is what lets toggling flat back off restore the
  user's shading and rim settings exactly. Do not "simplify" this into a data
  mutation in `remix` or `applyOrbType` — `remix.test.ts` asserts the
  no-mutation property and will fail.
- **Because it is render-side, `remix` needs no special casing at all.** `remix`
  returns `{ ...doc, … }`, so the flag survives; the shading and rim candidates are
  still drawn, keeping the RNG stream unchanged, and simply render suppressed.
  The user may set `shading.visible: true`; flat outranks it at render time.

It is deliberately **not** in `doc.locks` — a lock freezes values against
randomization, this changes what renders. `doc.colorSource`
(`'palette' | 'gradients'`) is a third standing preference with the same
citizenship: it survives remix via the spread and selects, at every gradient
site, between the dealt slot ramp and a named RSAC brand gradient
(`lib/brand.ts`) — both candidates are always drawn, so the stream never
depends on it.

**`doc.solidFills` is the second standing constraint**, same design and same
rules: render-side only (every smooth gradient collapses to its own mid-ramp
ink via `solidFor`), survives remix via the `{ ...doc }` spread, not in
`doc.locks`, asserted by the same no-mutation test pattern in `remix.test.ts`.
Suppressed: the disc gradient, the background gradient, sector ramp cells, and
the vignette (a smooth blend — unlike flat mode, which keeps it). Kept:
pattern-internal gradient spreads (artwork texture). Independent of `flat` on purpose — gradients read
as sphere surfaces, shading as sphere lighting, and either cue can go alone.

### Pattern pipeline (three files, one flow)

`src/lib/patterns/` — `source.ts` → `parse.ts` → `registry.ts`.

`Patterns/` at the repo root is the source of truth. Duplicate SVGs sit loose in
the root folder and are **deliberately not globbed**. There are **27** files — the original 18 plus nine curated from the RSAC framed-patterns boards (2026-08-25).
`source.ts` globs them with `import.meta.glob(…, {query:
'?raw'})` lazily, so each is its own bundle chunk.

`parse.ts` converts raw SVG into a `ParsedPattern`: a `template` string where
every color literal has become a `%%cN%%` token, plus color groups. Recoloring is
then one string pass in `registry.ts` (`resolveTokens` → `recolor`). Non-obvious
parts, all load-bearing:

- **`<mask>`, `<clipPath>`, `<pattern>`, `<marker>`, `<filter>` subtrees are
  skipped.** Colors in there are structural — recoloring the `fill="white"`
  inside a luminance mask destroys the mask.
- **Colors cluster in OKLab** into ≤8 groups (`MAX_GROUPS`). Within a group each
  color keeps its **lightness offset from the group mean**, so a pattern built
  from gradients still reads as a gradient after being mapped onto one palette
  slot.
- **The full-bleed background plate is detected** (`rectIsFullBleed` /
  `pathIsFullBleed`) because these Figma exports usually open with one. It
  becomes group `Plate` and defaults to `alpha: 0` so patterns read as texture.
  `pathIsFullBleed` is conservative on purpose — a single rectilinear subpath
  only; several files start with a huge multi-`M` path that would otherwise be
  misread as a plate.
- **Ids are namespaced per rendered instance, not per pattern.** `parse.ts` emits
  a `%%ns%%-{id}` placeholder and `recolor()` substitutes it alongside the colour
  tokens; `PatternLayerView` passes `${prefix}-${layer.id}`. This must stay
  per-instance: `url(#…)` resolves document-wide to the *first* match, and
  recolouring rewrites gradient stops inside these defs, so two layers sharing a
  namespace makes the second paint with the first's colours. Two layers on one
  `patternId` happen routinely (remix picks with replacement), as does the editor
  preview coexisting with batch cells.
- Alpha 0 emits `transparent`, not `#rrggbb00` — valid in `fill`, `stroke` and
  `stop-color` alike.

Group counts differ per pattern, so changing a layer's `patternId` must re-derive
`colors` (see `onSetLayerPattern` in `App.tsx`), never keep the old array.

### Color indirection

Every colored value in the document is a `ColorRef` (`{ slot, hex?, alpha? }`) —
never a raw hex. `slot` indexes the active palette; `hex` is a per-element
override that wins when set. That is what makes switching palettes recolor the
whole composition. Resolve through `resolveColor()`/`refAlpha()` in
`src/lib/palettes.ts`; do not read `palette.colors[i]` directly.

**Palette slot ordering is a contract:** slot 0 trends darkest, last slots
lightest. `slotsByLightness` and the remix `buildDeck` dark/mid/light split rely
on it. New palettes must follow it — sort by OKLab lightness before adding one.

Out-of-range slots **clamp**, they do not wrap. Wrapping sends a slot past the
light end straight back to the darkest color, which puts a hard dark band through
any gradient authored against a longer palette. Palettes shorter than the ~8 slots
the default document assumes are normal (pasting four hex codes makes one), so
this path is hit in practice.

Built-ins live in `BUILTIN_PALETTES` — currently 18, all sampled from reference
material: seven from the image boards in `Palettes/` and eleven from the
`Palettes/Gradients/` SVGs, each with a comment naming its source file. The
original hand-authored set is retired but kept in a comment block above them;
leave it there rather than deleting or reviving it.

### Layer stack

`doc.layers` is an ordered, reorderable array of `pattern` | `shading` |
`accent`. Background sits below the stack and the orb base gradient directly
above it — both fixed, because reordering either above the pattern layers could
only hide them. Pattern layers are clipped to the orb circle; **accents are
not**, which is what makes stack order worth having (an accent layer below the
patterns puts a ring behind the orb).

The sidebar surfaces the same shading/accent layer twice: once inline in the
Layers list and once in its own numbered section. Both edit the same layer by id.

### Remix determinism

`seed → mulberry32` (`src/lib/rng.ts`), so a typed seed reproduces its output
exactly. Since v4, `remix()` draws **fixed-width candidates**: every count is
rolled and every candidate drawn at maximum width (`MAX_PATTERN_LAYERS`,
`MAX_SECTOR_CELLS`, a brand-pick float at every gradient site), then every lock
at every level — section, sub-lock, property — is applied as a pure selection
consuming zero draws. The invariant is **strict**: the number of draws depends
on the seed and on doc/deps state (does a shading layer exist, are patterns
parsed), never on any lock. The old grandfathered `lockPatternCount` draw-count
exemption is gone; do not reintroduce one. The same rule applies inside
`remixGradient`, `remixPatternLayer` and `remixAccents`, which each have a
`lockColors` path, and inside `dealFill`'s colorSource selection.

The v4 restructure was a deliberate one-time seed break (accepted 2026-08-25):
pre-v4 seeds do not reproduce their outputs.

This was violated once and fixed — see CHANGELOG. `src/lib/remix.test.ts` now locks
it in, along with lock absoluteness and stack-position preservation, so `npm test`
catches a regression. When you change `remix()`, run it — and if you add an
assertion, sabotage it once to confirm it is not passing vacuously.

**A lock is absolute** — this is a stated product rule, not an implementation
detail, and it holds at every level of the tree. Nothing writes to a locked
value: not Remix, not Remix All, not `shuffleColors` (which also respects
per-object `color` locks), not any dice — a sub-lock holds even against its own
section's dice — and **not `applyOrbType`** (which respects `locks.orb`, the
type sub-lock and `locks.patterns`, and reports what it skipped). Every exported
entry point guards, so a caller that forgets to check still cannot break the
rule; the UI additionally renders implied/partial lock states. Keep both halves
when adding a new randomizer *or a new macro*. Locks guard randomizers and
macros only — never the user's own hand-edits.

**What a lock does and does not freeze.** A section lock freezes that section's
**values** — settings and geometry. It does **not** pin the section's rendered
colors, because every color is a palette-slot reference (`ColorRef`), so swapping
the palette recolors locked sections too. That is the **Colors lock's** job, and it
is why "Remix All with Orb locked" looks like it changed the orb: the geometry
is byte-identical, but Remix All re-rolled the palette. Two consequences worth
keeping in mind:

- Do not "fix" this by having section locks capture literal hexes. Slot indirection
  is the whole point of the color system; freezing hexes would break palette
  switching for the locked section forever.
- The Orb section's hint reads `orbType`, which a section lock or type
  sub-lock freezes — but pattern-layer *visibility* still follows remix's type
  selection, honestly reporting what renders.

The lock chip's tooltip states the settings-vs-colors split (`lockTitle` in
`Section.tsx`); keep it accurate if the semantics ever change.

`remixSection()` randomizes one section by *inverting* the locks, so there is one
code path deciding what a section's randomization means. It leaves `doc.seed`
alone on purpose: the seed reproduces a full remix, and a partial one is an edit
like moving a slider.

`pickPalette()` lives in `remix.ts` rather than the caller so the seed drives the
palette choice too — otherwise typing a seed back would not reproduce a Remix All.

**Known, accepted limit:** `pickPalette` deliberately excludes the *current*
palette, so consecutive Remix All presses always change palette rather than
sometimes appearing to do nothing. The cost is that a Remix All seed reproduces its
palette choice only from the same starting palette — the pool it picks from depends
on `doc.paletteId`. This is a deliberate tradeoff, not a bug awaiting a fix; do not
"correct" it by making the pool unconditional without also deciding that repeated
Remix All should sometimes be a no-op.

`dealRamp` builds gradient stop runs from a **contiguous, non-wrapping** slice of
`slotsByLightness`, nudged so the run reaches the light end. Both constraints
exist because a wrapping run can come out entirely dark, which renders as a black
hole against a dark background rather than a orb.

### Batch and zip export

`ui/BatchPanel.tsx` renders N real `OrbSvg` instances and hands their live
nodes to `App.exportBatch`, which serializes them through the same
`serializeSvg` the single-file export uses — that is what guarantees a batch file
and a promoted-then-exported file are byte-identical. Every cell needs a distinct
`idPrefix`: they all share one document, and defs are referenced by id.

`lib/zip.ts` is a store-only ZIP writer (no deflate, no dependency). If you touch
it, re-verify with real `unzip -t` rather than trusting that it looks right — a
wrong CRC or central-directory offset produces a file that only fails when the
user opens it. The harness pattern that caught this: build the zip in the browser,
base64 it into a `<textarea>`, `--dump-dom`, decode, `unzip -t`.

### Library curation

The header's **Library** panel curates the remix deal: every pattern
(built-in, procedural, imported) has an include toggle, stored as an
*exclusion* list in `orbgen.patternPrefs.v1` so new patterns default in.
Excluding is non-destructive by contract: `parsedById` is never filtered, so a
document wearing an excluded pattern keeps rendering, and the pickers append
the in-use pattern as "(excluded)". Only `available` (remix's deps) and the
picker option lists are filtered — pool contents are deps state, which the
remix invariant explicitly permits. Deleting is real only for imports.

### Runtime pattern import

Dropped SVGs go through `importPatternSvg` → the same `parsePatternSvg` as
built-ins, so imports get identical fill extraction and palette mapping. The UI
reads `listPatternOptions()` (built-ins + imports) via a `patternRev` counter in
`App`, **not** `PATTERN_SOURCES` directly — a component that imports the static
list will silently miss imports.

Imports persist under a size budget (`storage.saveImportedPatterns` returns the
ids that did not fit). The cap exists because localStorage is shared with the
document and presets, and one 2 MB SVG would take those down with it.

### Doc migration

`DOC_VERSION` is 3. `loadDoc`/`loadPresets` run documents through
`normalizeDoc` rather than discarding them on a version mismatch — **presets
store whole documents**, so discarding would silently delete the user's saved
presets. When adding a field to the doc model, give it a default in
`normalizeDoc`.

v3 is the planet→orb rename, and it is the one migration that renames rather
than adds, so it has three moving parts that must stay together:

- `normalizeDoc` reads `doc.planet` when `doc.orb` is absent, maps `locks.planet`
  to `locks.orb`, and rewrites any pattern layer's `mask.mode: 'planet'` to
  `'orb'`. It deletes the stale `planet` key so the two never coexist.
- `loadDoc`'s shape guard accepts **either** `orb` or `planet`. Tightening it to
  `orb` alone rejects exactly the documents the migration exists to rescue.
- `storage.ts` reads through to the old `planetgen.*` localStorage keys when the
  `orbgen.*` key is missing, copying forward on first read and leaving the legacy
  key in place. Without it a returning user loses their document, custom
  palettes, presets and imported patterns at once — indistinguishable from the
  app wiping their work.

The legacy names are load-bearing compatibility, not leftovers. Do not "finish
the rename" by deleting them.

### Undo history

`src/state/useDoc.ts` owns document state: a past/present/future history with
coalescing and a debounced localStorage save. Two contracts for callers:

- Continuous controls (sliders, drags) pass a stable `coalesce` key so a drag
  collapses into **one** undo entry inside the 700 ms window; distinct edits need
  distinct keys or they merge.
- `transient: true` replaces the present without touching history at all — for
  live previews mid-gesture, with a real commit at the end.

The hook is StrictMode-safe by construction (this regressed once — see
CHANGELOG); keep effects idempotent if you touch it.

## Reference material

`Examples/` holds the target aesthetic. `image 41.png` is the sliced-sphere
sweep; `image 40.png` and `Frame 468.png` show pattern-filled gradient discs.
The look to match is **crisp ink** — flat color, `normal` blend, high opacity,
large scale — not low-opacity soft-light washes. Defaults and remix weighting are
tuned that way; keep them there.

`CLAUDE-CODE-PROMPTS.md` is the original brief. **All three prompts are
implemented.** `CLAUDE-CODE-FIX-PROMPTS.md` is the code-review follow-up log —
all nine of its prompts are implemented too; treat both as history, not a
to-do list. Keyboard shortcuts are `R`, `⇧R`, `S`, `E`, `B`, `Esc`, and
`⌘Z` / `⇧⌘Z`.

## Editor chrome

Follows the FinalFinal™ design system (see the `finalfinal-ui` skill): flat,
`border-radius: 0`, IBM Plex Mono for labels and numerics, Inter for body, one
accent `#DA3832` used sparingly, 1px dividers, no shadows and no gradients in the
chrome. Section padding steps down from the system's 60px to the 5px grid so the
control panel works at sidebar width. Tokens live at the top of `src/index.css`.
Every continuous value gets both a slider and a numeric input.
