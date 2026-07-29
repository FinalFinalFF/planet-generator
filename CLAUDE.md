# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Vite dev server on :5173
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -b --noEmit
```

`tsconfig.json` sets `noUnusedLocals`/`noUnusedParameters`, so an unused import
fails the build, not just lint. There is no linter and no test framework.

### Verifying changes

There are no automated tests — this is a visual tool, and correctness means "it
looks right and the export matches the preview". The `mcp__claude-in-chrome__*`
tools are not connected on this machine; drive Chrome from the CLI instead:

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
palettes, a contact sheet of all 17 patterns, and a
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

### Pattern pipeline (three files, one flow)

`src/lib/patterns/` — `source.ts` → `parse.ts` → `registry.ts`.

`Patterns/` at the repo root is the source of truth. Duplicate SVGs sit loose in
the root folder and are **deliberately not globbed**. There are **17** files (the
original brief said 18). `source.ts` globs them with `import.meta.glob(…, {query:
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
- **Ids are namespaced** so many patterns coexist in one `<defs>`.
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

**A lock is absolute** — this is a stated product rule, not an implementation
detail. Nothing writes to a locked section: not Remix, not Remix All, not
`shuffleColors`, not that section's own dice. Every exported entry point in
`remix.ts` early-returns on `doc.locks`, so a caller that forgets to check still
cannot break the rule; the UI additionally disables controls a lock has made
inert. Keep both halves when adding a new randomizer.

`remixSection()` randomizes one section by *inverting* the locks, so there is one
code path deciding what a section's randomization means. It leaves `doc.seed`
alone on purpose: the seed reproduces a full remix, and a partial one is an edit
like moving a slider.

`pickPalette()` lives in `remix.ts` rather than the caller so the seed drives the
palette choice too — otherwise typing a seed back would not reproduce a Remix All.

`dealRamp` builds gradient stop runs from a **contiguous, non-wrapping** slice of
`slotsByLightness`, nudged so the run reaches the light end. Both constraints
exist because a wrapping run can come out entirely dark, which renders as a black
hole against a dark background rather than a planet.

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

`CLAUDE-CODE-PROMPTS.md` is the original brief. **Prompts 1 and 2 are
implemented; Prompt 3 is not** — no batch/N-up grid, no zip export, no
drag-and-drop pattern import at runtime. Keyboard shortcuts are `R` / `⇧R` /
`S` / undo / redo.

## Editor chrome

Follows the FinalFinal™ design system (see the `finalfinal-ui` skill): flat,
`border-radius: 0`, IBM Plex Mono for labels and numerics, Inter for body, one
accent `#DA3832` used sparingly, 1px dividers, no shadows and no gradients in the
chrome. Section padding steps down from the system's 60px to the 5px grid so the
control panel works at sidebar width. Tokens live at the top of `src/index.css`.
Every continuous value gets both a slider and a numeric input.
