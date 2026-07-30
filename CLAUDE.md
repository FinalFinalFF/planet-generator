# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Vite dev server on :5173 (redirects to the /planet-generator/ base)
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

The `base` means the dev server serves from `/planet-generator/`; it redirects `/`,
so the screenshot recipe below still works, but a QA route lives at
`http://localhost:5173/planet-generator/qa.html`.

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
palettes, a contact sheet of all 18 patterns, and a
live-preview / exported-SVG / rasterized-PNG triptych for export parity.

## Architecture

### The one invariant: a single `<svg>` is the source of truth

`src/render/PlanetSvg.tsx` renders the entire artwork as inline SVG.
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
  export can drop it wholesale; `serializeSvg` then strips all `data-*`.

Shading is the subtle case: its children each carry their own
`mix-blend-mode` and their own opacity, and the wrapping `<g>` deliberately has
**no `opacity` attribute**. Group opacity would isolate the group and stop the
terminator shadow from multiplying against the planet beneath it.

### Planet render modes

`planet.mode` is `disc` (gradient-filled circle) or `sliced`. `SlicedPlanet`
builds the reference's banded lattice from **concentric circles about a focus
outside the planet**, drawn largest first so each smaller circle paints over the
last and leaves an annulus visible. Two things there are load-bearing and easy to
undo by accident:

- **The base family must stay near-opaque** (`slices.alpha` ≈ 1). The bands *are*
  the crescents left over from overpainting; a uniformly translucent stack just
  lets the last circle drawn swamp everything under it. An earlier version
  modeled this as marching translucent discs and produced a flat blob.
- **Band radii are derived, not authored** — `dist ± r * 1.04` from the focus, so
  they always span the disc. There is deliberately no radius control.

`slices.blend` defaults to `multiply`; `screen` washes the disc toward white and
loses the base hues. Slices are always clipped to the circle — concentric bands
have no scalloped silhouette to gain by running free, they just flood the canvas.

### Pattern layer masks

`layer.mask` restricts where a pattern paints: `planet`, `lens` (intersection with
an offset circle) or `outside-lens`, with a `feather`. Implemented as an SVG
`<mask>` rather than nested clip paths, because one mechanism then covers all
three cases plus the soft edge. Masks are luminance-based, so the feather
gradient's stop colors invert between `lens` and `outside-lens`.

### Planet styles

`applyPlanetStyle` in `lib/defaults.ts` holds the recipes behind the "Planet
style" dropdown. Each rewrites planet mode, shading, and layer visibility
*together* and leaves palette, canvas, seed, locks and pattern choices alone.
`detectPlanetStyle` reports which one the document resembles, or `custom`. When
adding a style, add it to `PLANET_STYLES` and `PLANET_STYLE_LABELS` in
`types.ts` — the dropdown is generated from those.

### Flat mode

`doc.flat` suppresses every 3D cue: the shading layer entirely, plus the accent
layer's crescent rim light. Gradients, patterns, rings, satellites, background and
the vignette all stay — the vignette because it is a canvas treatment that would
look the same behind a square.

Two properties are load-bearing:

- **Suppression is render-side only.** `PlanetSvg` skips `ShadingLayerView` and the
  rim crescent (with its gradient def, so no dead markup reaches the export);
  nothing rewrites layer data. That is what lets toggling flat back off restore the
  user's shading and rim settings exactly. Do not "simplify" this into a data
  mutation in `remix` or `applyPlanetStyle` — `remix.test.ts` asserts the
  no-mutation property and will fail.
- **Because it is render-side, `remix` needs no special casing at all.** `remix`
  returns `{ ...doc, … }`, so the flag survives; the shading and rim candidates are
  still drawn, keeping the RNG stream unchanged, and simply render suppressed. A
  style may set `shading.visible: true`; flat outranks it at render time.

It is deliberately **not** in `doc.locks` — a lock freezes values against
randomization, this changes what renders. `detectPlanetStyle` treats shading as
invisible when flat, so a suppressed-shading document does not claim to be
`shaded-sphere`.

### Pattern pipeline (three files, one flow)

`src/lib/patterns/` — `source.ts` → `parse.ts` → `registry.ts`.

`Patterns/` at the repo root is the source of truth. Duplicate SVGs sit loose in
the root folder and are **deliberately not globbed**. There are **18** files.
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

Built-ins live in `BUILTIN_PALETTES`; the seven sampled from `Palettes/` carry a
comment naming the source image.

### Layer stack

`doc.layers` is an ordered, reorderable array of `pattern` | `shading` |
`accent`. Background sits below the stack and the planet base gradient directly
above it — both fixed, because reordering either above the pattern layers could
only hide them. Pattern layers are clipped to the planet circle; **accents are
not**, which is what makes stack order worth having (an accent layer below the
patterns puts a ring behind the planet).

The sidebar surfaces the same shading/accent layer twice: once inline in the
Layers list and once in its own numbered section. Both edit the same layer by id.

### Remix determinism

`seed → mulberry32` (`src/lib/rng.ts`), so a typed seed reproduces its output
exactly. When adding to `remix()`, **consume the RNG stream in a fixed order
regardless of which sections are locked** — a locked section still runs its RNG
draws and throws the result away. Short-circuiting before the draws would shift
every downstream section when an unrelated lock is toggled.

Structurally, that means: compute every section's candidate unconditionally and in
a fixed order, then apply the locks as a pure selection between the candidate and
the incoming value. **Never branch on a lock in a way that changes how many values
are drawn** — compute both and choose. The draw count may legitimately depend on
doc state (how many layers exist, `lockPatternCount`, `prevPatterns.length`) and on
earlier draws (`!sliced && rng.bool(…)`); it must not depend on `doc.locks`. The
same rule applies inside `remixGradient`, `remixPatternLayer` and `remixAccents`,
which each have a `lockColors` path.

This was violated once and fixed — see CHANGELOG. `src/lib/remix.test.ts` now locks
it in, along with lock absoluteness and stack-position preservation, so `npm test`
catches a regression. When you change `remix()`, run it — and if you add an
assertion, sabotage it once to confirm it is not passing vacuously.

**A lock is absolute** — this is a stated product rule, not an implementation
detail. Nothing writes to a locked section: not Remix, not Remix All, not
`shuffleColors`, not that section's own dice, and **not `applyPlanetStyle`** (which
respects the locks per section and reports which ones it skipped, so the UI can say
so). Every exported entry point in `remix.ts` early-returns on `doc.locks`, so a
caller that forgets to check still cannot break the rule; the UI additionally
disables controls a lock has made inert. Keep both halves when adding a new
randomizer *or a new macro*.

**What a lock does and does not freeze.** A section lock freezes that section's
**values** — settings and geometry. It does **not** pin the section's rendered
colors, because every color is a palette-slot reference (`ColorRef`), so swapping
the palette recolors locked sections too. That is the **Colors lock's** job, and it
is why "Remix All with Planet locked" looks like it changed the planet: the geometry
is byte-identical, but Remix All re-rolled the palette. Two consequences worth
keeping in mind:

- Do not "fix" this by having section locks capture literal hexes. Slot indirection
  is the whole point of the color system; freezing hexes would break palette
  switching for the locked section forever.
- The `detectPlanetStyle` dropdown reads pattern/shading *visibility*, so remixing
  those flips the Composition style label even when the planet is locked. That is
  the label reporting the composition honestly, not a leak.

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
hole against a dark background rather than a planet.

### Batch and zip export

`ui/BatchPanel.tsx` renders N real `PlanetSvg` instances and hands their live
nodes to `App.exportBatch`, which serializes them through the same
`serializeSvg` the single-file export uses — that is what guarantees a batch file
and a promoted-then-exported file are byte-identical. Every cell needs a distinct
`idPrefix`: they all share one document, and defs are referenced by id.

`lib/zip.ts` is a store-only ZIP writer (no deflate, no dependency). If you touch
it, re-verify with real `unzip -t` rather than trusting that it looks right — a
wrong CRC or central-directory offset produces a file that only fails when the
user opens it. The harness pattern that caught this: build the zip in the browser,
base64 it into a `<textarea>`, `--dump-dom`, decode, `unzip -t`.

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

`DOC_VERSION` is 2. `loadDoc`/`loadPresets` run documents through
`normalizeDoc` rather than discarding them on a version mismatch — **presets
store whole documents**, so discarding would silently delete the user's saved
presets. When adding a field to the doc model, give it a default in
`normalizeDoc`.

## Reference material

`Examples/` holds the target aesthetic. `image 41.png` is the sliced-sphere
sweep; `image 40.png` and `Frame 468.png` show pattern-filled gradient discs.
The look to match is **crisp ink** — flat color, `normal` blend, high opacity,
large scale — not low-opacity soft-light washes. Defaults and remix weighting are
tuned that way; keep them there.

`CLAUDE-CODE-PROMPTS.md` is the original brief. **All three prompts are
implemented.** Keyboard shortcuts are `R`, `⇧R`, `S`, `E`, `B`, `Esc`, and
`⌘Z` / `⇧⌘Z`.

## Editor chrome

Follows the FinalFinal™ design system (see the `finalfinal-ui` skill): flat,
`border-radius: 0`, IBM Plex Mono for labels and numerics, Inter for body, one
accent `#DA3832` used sparingly, 1px dividers, no shadows and no gradients in the
chrome. Section padding steps down from the system's 60px to the 5px grid so the
control panel works at sidebar width. Tokens live at the top of `src/index.css`.
Every continuous value gets both a slider and a numeric input.
