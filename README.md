# Planet Generator

Client-side brand-graphics generator for "planet" discs: layered gradients and
geometric patterns clipped to a circle. Vite + React + TypeScript, no backend.

**Live: https://finalfinalff.github.io/planet-generator/**

There is no server and no shared state. Documents, palettes and presets live in
`localStorage`, which is per-origin and per-browser — everyone who opens the page
gets their own, and nothing you make is visible to anyone else or to us.

Pushing to `main` deploys via GitHub Actions. The workflow runs `npm run build`,
which is `tsc -b && vite build`, so a type error fails the deploy rather than
shipping a broken page.

`Examples/`, `Palettes/` and `Frame 468.png` are reference material and are
deliberately **not** tracked in git — they are third-party posters and brand
boards, and this is a public repo. They are not needed to build. `Patterns/` *is*
tracked, because the build globs it.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle into dist/
npm run typecheck
```

## How it renders

A single inline `<svg>` element is the source of truth. Everything — background,
planet gradient, pattern layers, shading, accents — is real SVG, so **SVG export
is a direct serialization of that live node**. Canvas is used only to rasterize
PNGs at export time.

Two consequences worth knowing:

- **Conic gradients are built from wedge geometry**, not a CSS `conic-gradient`.
  SVG has no conic gradient, and a CSS one would not survive serialization, so
  the sweep is approximated with N wedge paths (`segments`, default 180–240)
  whose fills are interpolated in OKLab. Preview and export are identical.
- **Blend modes are inline `mix-blend-mode`.** They render in every modern
  browser, including when the exported file is opened standalone or loaded as an
  `<img>`, which is also the PNG rasterization path.
- **Tiled patterns are expanded on SVG export** (Export → *Expand pattern
  tiles*, on by default). See below.

### Pattern fills and design tools

Tiled pattern layers paint as `<rect fill="url(#somePattern)">`. That is correct
SVG and renders in every browser, but **design-tool importers commonly ignore
`<pattern>` fills** — Figma drops them, which leaves the gradient with no texture
at all while the PNG of the same document looks right.

So SVG export rewrites each pattern fill into the tiles it would have painted:
same geometry, same paint, stamped explicitly. The rewrite happens on the export
clone, hoists the tile's own `<defs>` once (cloning them per tile would repeat
their ids), and clips each tile to its cell because several source patterns
overhang their viewBox. Verified pixel-equivalent to the `<pattern>` version —
the only difference is 1px of antialiasing along edges.

It costs size: roughly 3–4× for a mid-size pattern. Turn it off for a small,
browser-only file. PNG export never expands, since the rasterizer tiles correctly
and expanding would only bloat the intermediate string.

Expansion is skipped, with a warning, for a layer needing more than 900 tiles or
whose expansion would exceed 16 MB — tile count alone is a poor guard when the
source patterns range from 12 kB to 330 kB of markup.

## Importing patterns

Drop `.svg` files anywhere on the app. Each one runs through the *same*
`parsePatternSvg` as the built-in library, so it gets identical fill extraction,
OKLab colour grouping, plate detection and palette-slot mapping — then shows up in
the pattern pickers (tagged `(imported)`) and becomes eligible for Remix.

Imports are kept in localStorage so a composition survives a reload, but bounded:
512 KB per file and 3 MB in total, because these files run to hundreds of KB and
blowing the quota would take the document and presets down with it. Anything over
budget stays in memory for the session and says so.

## Pattern pipeline

`Patterns/` at the repo root is the source of truth — the duplicate SVGs sitting
next to it in the root folder are deliberately not globbed. There are **18**
files.

Each file is fetched lazily (`import.meta.glob` + `?raw`, one chunk per pattern),
then at load time `src/lib/patterns/parse.ts`:

1. reads the `viewBox` as the tile box;
2. walks every drawable element, **skipping `<mask>`, `<clipPath>`, `<pattern>`,
   `<marker>` and `<filter>` subtrees** — colors in there are structural, and
   recoloring the white inside a luminance mask would destroy the mask;
3. replaces each literal color (`fill`, `stroke`, `stop-color`, `flood-color`,
   `lighting-color`, and the same properties set via `style=""`) with a
   `%%cN%%` token;
4. clusters the unique colors in OKLab into at most 8 assignable groups;
5. detects the full-bleed background plate these Figma exports usually open
   with, so it can default to hidden and the pattern reads as texture;
6. namespaces every `id` so many patterns coexist in one `<defs>`.

Recoloring is then a single string pass. Within a group, each original color
keeps its **lightness offset from the group mean**, so a pattern built out of
gradients still reads as gradients after being mapped onto one palette slot.

## Color system

Palettes are named, ordered hex lists; slot 0 trends darkest and the last slots
lightest (the remix and default-mapping heuristics rely on that ordering). Every
colored element stores a `ColorRef` — `{ slot, hex?, alpha? }` — so switching
palettes recolors the whole composition instantly, while `hex` is a per-element
override that wins when set.

Out-of-range slots **clamp** to the lightest color rather than wrapping. Wrapping
sends a slot past the light end back to the darkest one, which puts a hard black
band through any gradient authored against a longer palette — and short palettes
are common, since pasting four hex codes makes one.

Fourteen built-ins ship. Seven are tuned to `Examples/`; the other seven are
sampled from the boards in `Palettes/`:

| Palette | Source |
|---|---|
| Aurora Signal | `Group 458.png` — cyan and violet over near-black |
| Coral Ateneo | `image 31.png` / `Group 459.png` — names its own swatches |
| Pale Ember | `image 1.png` — teal-to-ember on a pale green ground |
| Golden Hours | `image 32.png` — the twilight→dawn→noon→sunset→night set |
| Neon Vapour | `image 24.png` — saturated gradient tiles on near-black |
| Cobalt Pixel | `image 30.png` — cobalt with ink, lilac, amber, white |
| Charcoal Bloom | `image 6.png` — charcoal lit by blue and amber bloom |

Anchor colors are sampled straight off the source images. Where a board gave
fewer than about six tones, intermediates were interpolated so the dark / mid /
light thirds the remix deck splits on all exist.

## Planet styles

The **Planet style** dropdown at the top of the Planet section applies a recipe
that rewrites the planet mode, the shading, and which layers are visible
together — the looks in the reference material are combinations, not single
settings. Palette, canvas, seed, locks and pattern choices are left alone, and
the whole thing is one undo step.

| Style | What it is |
|---|---|
| Flat disc | Gradient circle, no shading — the plain discs of `image 40` |
| Shaded sphere | Gradient plus tuned terminator, highlight and limb darkening |
| Patterned disc | Crisp full-disc ink, shading pulled back so it stays legible |
| Overlap bloom | Each pattern confined to a feathered lens, so textures meet in patches |
| Sliced sweep | The banded lattice of `image 41` |

The dropdown also reports **Custom** when the document does not match any recipe
— for instance the shipped default, which mixes full-disc ink with one lens
patch.

### Sliced sweep

A family is a set of concentric circles about a focus sitting *outside* the
planet, drawn largest first so each smaller circle paints over the last. What
stays visible of each is an annulus, and because the focus is off to one side
those annuli read as curved bands sweeping across the disc. Band radii are
derived from the focus distance so they always span the planet exactly — there is
no radius control to get wrong.

A second family with a focus `fan` degrees away is laid over translucently, and
its bands cross the first family's to cut the flat diamond cells.

Two things are load-bearing:

- **Keep base opacity near 1.** That is what leaves a crescent of each circle
  visible. A uniformly translucent stack just lets the last circle drawn swamp
  everything under it — which is what the first attempt at this did.
- **Multiply, not screen, for the lattice.** Screen washes the whole disc toward
  white and loses the base hues.

`curvature` is the focus distance in planet radii: near 1 the bands curve hard,
larger values flatten them toward straight stripes. Slices are always clipped to
the circle — concentric bands have no scalloped silhouette to gain by running
free, they just flood the canvas.

## Layers

The stack is ordered and reorderable: pattern layers, sphere shading, and
accents, painted bottom to top. Background sits below the stack and the planet
base gradient directly above it — reordering either above the pattern layers
would only hide them, so they are fixed. Accents are *not* clipped to the
circle, so dragging an accent layer below the pattern layers puts a ring behind
the planet.

Each pattern layer also has an **overlap region**: `whole disc`, `lens` (the
intersection with an offset circle) or `outside lens`, with a `feather` for a
soft edge. That is what produces the lens-shaped pattern patches in `image 40`,
where a circle shows texture only where it meets another. It is implemented as an
SVG `<mask>` rather than nested clip paths, because one mechanism then covers the
lens, its complement, and the feather.

## Remix

`seed → mulberry32` drives everything, so typing a seed reproduces the output
exactly — including which palette **Remix All** picked.

| Control | Scope |
|---|---|
| **Remix All** (`⇧R`) | Everything, including switching to a random palette |
| **Remix** (`R`) | Everything except the palette |
| **Shuffle colors** (`S`) | Re-deals palette slots, touching no geometry |
| Per-section ⟳ | That section only — Background, Planet, Layers, Shading, Accents |
| Palette ⟳ | Switches to a random palette, changing nothing else |
| **Batch** (`B`) | An N-up grid of remixes to cherry-pick from |

The per-section dice is the inverse of the locks and is implemented by inverting
them, so there is only one code path deciding what randomizing a section means.
It deliberately leaves `doc.seed` alone: the header seed reproduces a *full*
remix, and a partial one is an edit like moving a slider.

### Batch mode

**Batch** (`B`) replaces the stage with an N-up grid (3×3 to 5×5) of seeded
remixes of the current document, so a run can be cherry-picked instead of stepped
through one Remix at a time. **Promote** loads a cell into the editor.

Cell seeds derive from the batch seed (`batch-xxxxxx-1`, `-2`, …), so a batch is
reproducible and *Regenerate* is just a new batch seed. **Vary palette** gives
each cell its own palette, and is disabled while colors are locked.

**Export all (zip)** writes every cell as SVG, PNG, or both. Each cell is a real
`PlanetSvg`, and the export serializes those live nodes — the same path the
single-file export uses — so a file from a batch is identical to promoting that
cell and exporting it on its own.

The zip is built by `lib/zip.ts`, a store-only ZIP writer with no dependency.
Deflate is skipped on purpose: PNGs are already compressed, and a compression
library is not worth a dependency in an app that otherwise ships only React.

### Pattern layer count

**Lock pattern layer count** in the Layers section pins how many pattern layers a
remix produces while still letting it re-roll what each one is. That is the way to
stay at, say, a single texture without giving up randomization inside it. It is
separate from the section `LOCK`, which freezes the layers outright.

### Locks are absolute

`LOCK` on a section means nothing writes to it — not Remix, not Remix All, not
Shuffle colors, not that section's own dice. Every entry point in `remix.ts`
guards on `doc.locks`, so a caller that forgets to check still cannot break the
rule, and the UI disables the controls a lock has made inert.

The RNG stream is still consumed in a fixed order whether or not a section is
locked, so toggling one lock does not shift what the others produce.

Keyboard: `R` remix, `⇧R` remix all, `S` shuffle colors, `E` export SVG, `B`
batch, `Esc` close batch, `⌘Z` / `⇧⌘Z` undo/redo. `E` uses the same
transparent-background toggle as the Export panel.

## Persistence

Document, custom palettes, named presets, and UI preferences live in
localStorage under `planetgen.*`, along with imported patterns. Every read is
defensive and falls back to the shipped default on bad data.

Documents are at `DOC_VERSION` 2. Older ones are **migrated** by `normalizeDoc`
rather than discarded, which matters because presets store whole documents — a
preset saved before the sliced mode existed still loads.

## UI

Chrome follows the FinalFinal™ design system: flat, sharp corners, IBM Plex Mono
labels, one accent (`#DA3832`), 1px dividers, no shadows or gradients. Section
padding steps down from the marketing 60px to the 5px grid so the control panel
stays usable at sidebar width. Aeonik is used when installed locally, with Plus
Jakarta Sans / Inter / IBM Plex Mono as the web fallbacks — the app itself needs
no network access.
