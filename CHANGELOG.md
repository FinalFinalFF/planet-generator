# Changelog

A record of what changed and **why** — decisions, the reasoning behind them,
things that were tried and abandoned, and bugs with how they were found. Commit
messages cover the what; this file exists for the parts that would otherwise be
lost, so the next person (or the next session) does not re-litigate a settled
choice or re-introduce a fixed bug.

Newest first. Keep entries honest: record reversals and dead ends, not just wins.

---

## Unreleased

### Fixed: closing the tab inside the save debounce lost the last change

`useDoc` debounces `saveDoc` by 350 ms and `App` debounces UI state by 300 ms.
Closing or discarding the tab inside that window dropped whatever had just
changed.

Both now also flush on the way out, on `pagehide` and on `visibilitychange` →
`hidden`. `pagehide` rather than `beforeunload` because the latter is skipped when
a page enters the back/forward cache, and `unload` is unreliable on mobile;
`visibilitychange` covers a tab being backgrounded and then discarded without
pagehide ever firing. localStorage writes are synchronous, so a flush from those
handlers completes. The debounce is unchanged for the steady state — the listener
is purely a flush.

The pending value is held in a ref written from the same effect that schedules the
debounce, not during render.

Verified with a temporary QA route (since deleted): commit a change, assert nothing
is persisted yet, dispatch `pagehide`, assert the change is now in storage; repeat
for `visibilitychange`; and confirm the ordinary debounce still saves on its own.

### Fixed: undo history behaved differently in dev than in production

`useDoc`'s `replace()` and `update()` mutated `lastCommit.current` **inside** the
`setHistory` updater. StrictMode — enabled in `main.tsx` — double-invokes state
updaters precisely to surface that kind of impurity, and here it did: the first
invocation wrote `{ key, at: now }`, the second read its own write back, saw "same
coalesce key, 0 ms ago", and took the coalesce branch. The first commit of a slider
drag therefore never pushed a history entry, so undo skipped a step in dev while
working correctly in the production build.

**Fix: decide coalescing before calling `setHistory`.** `beginCommit(opts)` computes
`now`, reads the ref, derives the boolean and writes the ref; `setHistory` then gets
a pure updater closing over that decision. The recipe stays *inside* the updater —
it is pure and needs fresh state — only the decision moved out.

Consequence worth noting in the code (and commented there): when the updater's
`next === h.present` early-return fires, the hoisted `lastCommit` write has already
happened, so a no-op commit refreshes the coalesce window. Harmless — a commit that
changes nothing has nothing to undo.

The rule this protects: **dev must look like prod**, and that includes history. An
impure updater is invisible until StrictMode or a future concurrent-rendering
feature invokes it twice.

Verified with a temporary QA route (since deleted) that drives the hook inside a
real `<StrictMode>` boundary — more reliable than dragging a slider by hand: a
coalesced burst is one undo step; two bursts separated by more than the 700 ms
window are two steps landing on the intermediate then the original state;
non-coalesced commits each get their own entry; transient commits never enter
history. Then **sabotaged the fix** by putting the ref write back inside the updater
and confirmed the burst assertions fail (undo stopped moving at all, because the
entries were never pushed).

### Fixed: two layers of the same pattern shared one set of internal ids

**Root cause: `url(#…)` resolves document-wide, to the *first* matching id.**
`parse.ts` namespaced a template's internal ids by pattern id alone
(`p{patternId}-…`). Recolouring rewrites gradient stop colours *inside* those
defs, so any second instance of the same pattern in one HTML document injected
duplicate ids and silently painted with the **first instance's colours**.

Reachable three ways, all routine: two pattern layers on the same `patternId`
(remix picks with replacement), the editor preview alongside a BatchPanel cell, or
two batch cells. "Blue Orange Purple Bauhaus Circle Pattern 1.svg" has 9 `url(#)`
gradient references, so it showed the failure immediately.

**Fix: instance namespacing is now part of recolouring.** `parse.ts` emits a
`%%ns%%-{id}` placeholder — same `%%…%%` convention as the `%%cN%%` colour tokens
— in `id=""`, `url(#…)` and `href="#…"` alike. `recolor()` substitutes it in the
same single string pass as the colours, and `PatternLayerView` passes
`${prefix}-${layer.id}`: `prefix` is the per-`<svg>` `idPrefix`, so the namespace
is unique across layers *and* across the editor/batch instances. Namespacing at
recolour time rather than parse time is the point — the template is shared, the
instance is not.

**Side effect in `expandPatternFills`, which had a latent version of the same
bug.** Its hoisted tile `<defs>` collided when one export contained two layers of
the same pattern; per-instance ids fix that for free. The `${id}-tile` clipPath it
mints derives from the pattern element id (`{prefix}-pc-{layer.id}`), so it was
already per-instance unique — confirmed, not changed.

**Found while verifying: expansion duplicated ids on its own.** It hoisted only
`<defs>`, but these Figma exports also put `<mask>` and `<clipPath>` inline in tile
*content*, so those were cloned once per tile. Now every non-rendering definition
element is hoisted (`defs, clipPath, mask, linearGradient, radialGradient,
pattern, filter, symbol, marker`), which is safe because none render in place and
`userSpaceOnUse` geometry resolves against the *referencing* element's space — one
hoisted copy serves every tile. Anything still carrying an id after that is
renderable and cannot be hoisted, so expansion bails for that layer with a warning
rather than emitting duplicates. That guard never triggers for the shipped library
(all its ids are on definition elements); it exists for imported SVGs.

No migration needed: templates are built at load time and never persisted —
`saveImportedPatterns` stores `{id, name, raw}` source text only. Confirmed by
grep, not assumed.

Verified with a temporary QA route (since deleted): one document with two layers of
the Bauhaus pattern forced to literal red and blue, rendered beside a second
`<svg>` using a batch-style `idPrefix`. Asserted no duplicate ids, no unresolved
refs, no `%%ns%%` leftovers, and both colours present; then exported with
`expandPatterns` on and re-rendered the file in the browser. Then **sabotaged the
fix** back to pattern-id-only namespacing and confirmed the failure reappears —
duplicate `mask0_24_3024` and `paint0/1_linear_*`, and the blue layer's
gradient-filled shapes rendering red (red samples 4,970 → 12,412).

### Fixed: remix() violated its own documented RNG invariant

CLAUDE.md and `remix.ts`'s own header both stated the rule — the RNG stream is
consumed in a fixed order regardless of which sections are locked, so toggling one
lock never shifts what an unrelated unlocked section produces for the same seed.
**The implementation did the opposite.** Every section short-circuited:

```ts
const background = locks.background ? doc.background : (() => { …draws… })()
const patterns   = locks.patterns   ? prevPatterns   : Array.from(…draws…)
```

When a section was locked its draws never ran, so every later section read a
different position in the stream. Locking the background changed the planet.
Confusingly, the newer code in the same function (`rolledCount`, `rolledBelow`,
the `sliced` roll) already did it correctly and said so in comments — the file
contained both styles.

**Fixed by computing every candidate unconditionally, in the existing order, then
applying the locks as a pure selection.** Draws-always is the rule because the
alternative — trying to keep parallel streams aligned across branches — is
unmaintainable: any future draw added inside a lock branch silently breaks
reproducibility, and nothing fails loudly when it does.

Four subtleties, all now covered by comments in the code:

- **The `locks.colors` paths had the same bug**, in `remixGradient` (per-stop
  jitter), `remixPatternLayer` (`remixPatternColors` not called), and
  `remixAccents` (`pickAccent`). Fixed the same way, since `colors` is a lock
  section and the stated invariant covers it. This went slightly beyond the
  reported scope, on the grounds that leaving a known violation in place would
  make the documented invariant false either way.
- **`slicedNow` reads the *selected* planet**, so a locked disc planet keeps its
  textures. That makes it lock-dependent, so the pattern-visibility roll it gates
  (`rng.bool(0.35)`) is now drawn unconditionally and only *applied* when the
  planet ends up sliced.
- **Layer-existence guards stay, lock guards go.** A document with no shading
  layer genuinely consumes fewer draws — that is doc state. Likewise
  `lockPatternCount` and `prevPatterns.length` may change the draw count, because
  they are doc state, not lock state.
- **`strokeEnabled` keeps its `!sliced && rng.bool(0.18)` short-circuit.** The
  draw count varies with the `sliced` roll, which is itself seed-derived — so the
  stream still depends only on the seed.

**Consequence:** any given seed now produces different output than before. Nothing
breaks — presets store whole documents, not seeds — but a seed written down
earlier will no longer reproduce what it did.

Verified with a temporary harness (28 assertions, since deleted): remix a fixture
with a fixed seed under no locks and under each single lock, asserting the
*unlocked* sections are deep-equal across all of them; that same seed + same locks
is reproducible; that locks do hold their own section; and that a document with no
shading or accent layer still behaves. Then **sabotaged the fix** — reintroduced
one lock-dependent draw — and confirmed the harness failed, so it is not passing
vacuously.

Ids are normalised out of those comparisons: `nextId` derives from `Date.now()`
and a module-global counter, not the RNG, so byte-identical JSON is asserted on
ids-normalised output. Stop and layer ids are React keys only; making them
seed-derived would risk colliding with ids retained by locked sections, which is
not worth it for values nothing reads.

### Export: pattern fills survive design-tool import

**Reported:** PNG export showed the planet's grid texture, the SVG export did
not.

**Diagnosed as the opposite of what it looked like.** The SVG was correct. Opened
standalone in Chrome it renders the grid perfectly; every `url(#…)` reference
resolves and the XML is well-formed. Both exports come from the same serialized
bytes, so the file was never the problem — the *viewer* was. Tiled pattern layers
paint as `<rect fill="url(#somePattern)">`, and design-tool importers commonly
ignore `<pattern>` fills. Figma drops them silently, leaving the gradient with no
texture.

**Added** `expandPatterns` (Export → *Expand pattern tiles*, default on):
rewrites each pattern fill into the tiles it would have painted. This is the one
sanctioned exception to "export is a pure serialization of the live node" — the
rewrite happens on the clone and is mechanical and equivalence-preserving.

Verified by rendering both versions and pixel-diffing rather than eyeballing:
max delta 79/255 confined to 1px edges, 0.64 % of pixels, amplified diff shows
only antialiasing outlines.

Two traps the verification caught, both worth remembering:

- **Duplicate ids.** Cloning tile content per tile also cloned the source
  pattern's `<defs>`, repeating their ids — and only the first duplicate
  resolves. Now hoisted once.
- **Overhang.** `<pattern>` clips tile content implicitly; several source
  patterns (Voronoi, the Bauhaus tiles) have geometry outside their viewBox. Each
  tile is clipped to its cell.

Guarded by both a tile count (900) and a byte budget (16 MB). Tile count alone is
insufficient — the source patterns range from 12 kB to 330 kB of markup, so 900
copies of the largest would be a 300 MB file. PNG export passes
`expandPatterns: false`; the rasterizer tiles correctly and expanding would only
bloat the intermediate string.

### Transparent background: verified, not changed

Asked to make sure exports are transparent when there is no background colour.
**Measured instead of assuming** — corner alpha of real exported PNGs and
background-element counts in real exported SVGs, across six configurations. It
already held in every case, including two the phrase could also have meant: a
solid fill with colour alpha 0, and a gradient whose stops are all alpha 0.

Two existing behaviours make it work: `showBackground` excludes
`kind === 'transparent'` so the whole background group — vignette included — is
never rendered; and `rasterizeSvg` never fills the canvas, so PNG alpha follows
the SVG.

**No behavioural change made.** Inventing a fix for working code only risks
breaking it. Added a note in the Export panel instead, since nothing in the UI
told you transparency was already in effect — which is presumably why it was
asked.

### Batch mode, zip export, runtime pattern import

- **Batch** (`B`): N-up grid (3×3–5×5) of seeded remixes with **Promote**. Cell
  seeds derive from the batch seed so a batch is reproducible and *Regenerate* is
  just a new batch seed. Each cell is a real `PlanetSvg`, which is what lets
  export serialize live nodes and guarantees a batch file matches
  promote-then-export.
- **Export all (zip)**: SVG, PNG or both. Zip written by `lib/zip.ts`,
  hand-rolled and store-only. Chose that over adding JSZip because PNGs are
  already compressed and this app otherwise ships only React. A wrong CRC or
  central-directory offset only fails when the user opens the file, so it was
  verified against real `unzip -t` plus a byte-for-byte round trip — first in
  Node, then end-to-end from the browser (build the zip in-page, base64 it out
  via `--dump-dom`, decode, validate).
- **Drag-and-drop pattern import**: dropped SVGs run through the *same*
  `parsePatternSvg` as the built-ins, so they get identical fill extraction and
  palette-slot mapping. Persisted under a size budget (512 kB/file, 3 MB total)
  because localStorage is shared with the document and presets — one oversized
  SVG would take those down with it.
- **Shortcuts**: `E` export, `B` batch, `Esc` close batch. Lifted the
  transparent-background toggle to `App` so `E` and batch export honour the same
  value rather than keeping a second copy.
- **Fixed:** a patterns-only remix restacked a *locked* accent layer to the top.
  Locked accents now keep whichever side of the patterns they were already on.

**Note:** components must read `listPatternOptions()`, not `PATTERN_SOURCES` —
anything importing the static list silently misses imports.

### Palettes, Remix All, per-section randomize

- **Seven palettes** sampled from the boards in `Palettes/` (14 total). Anchors
  read from the pixels rather than eyeballed, then sorted by OKLab lightness to
  satisfy the slot-ordering contract. Where a board gave fewer than ~6 tones,
  intermediates were interpolated so the remix deck still has dark/mid/light
  thirds.
- **Fixed — slot wrap.** Coral Ateneo shipped with 7 slots and rendered a hard
  black band: the default gradient references slot 7, and `resolveColor` wrapped
  it to slot 0. Out-of-range slots now **clamp**. This mattered well beyond that
  one palette — pasting four hex codes makes a short palette, so the wrap was
  reachable by any user.
- **Remix All** (`⇧R`) re-rolls the palette too. `pickPalette` lives in
  `remix.ts`, not the caller, so the seed drives the palette choice — otherwise
  typing a seed back would not reproduce the output.
- **Per-section randomize** (⟳ on Background, Planet, Layers, Shading, Accents,
  Palette): the inverse of the locks, implemented *by inverting them*, so one
  code path decides what randomizing a section means. It deliberately leaves
  `doc.seed` alone — the seed reproduces a full remix, and a partial one is an
  edit like moving a slider. Claiming otherwise would make the seed a lie.
- **Layer-count lock**: pins how many pattern layers a remix produces while still
  re-rolling what each one is, for staying at a single texture without giving up
  randomization inside it. Kept as a separate control from the section `LOCK`
  rather than overloading one.
- The `⟳` glyph rendered as a faint dot in IBM Plex Mono at 20 px, so the icon is
  a small inline SVG.

**Reversed:** `shuffleColors` was written to deliberately *bypass* the colours
lock, as an escape hatch for exploring colour against frozen geometry — and that
was documented as intentional. On instruction that **LOCKED overrides
everything**, every exported entry point in `remix.ts` now early-returns on
`doc.locks`, so a caller that forgets to check still cannot break the rule, and
the UI disables what a lock has made inert. Both docs were updated; they had
described the old behaviour.

### Fidelity pass: sliced sphere, overlap masks, planet styles

- **Sliced sphere — modelled wrong first.** The initial attempt was translucent
  discs marching across the planet. It produced a flat blob: with uniform alpha
  the last disc drawn swamps everything under it, and all the bands piled onto
  one side. Zooming into the reference showed the actual construction —
  **concentric circles about a focus outside the planet**, drawn largest-first so
  each smaller one overpaints the last and leaves an *annulus* visible. Those
  annuli are the curved bands, and they wrap the whole disc. A second family
  `fan` degrees away, laid over translucently, cuts them into the diamond cells.
  Two things are load-bearing: the base family must stay near-opaque, and the
  lattice wants `multiply` (`screen` washes the disc toward white).
- **Dropped** the slice clip-to-circle toggle. With concentric bands there is no
  scalloped silhouette to gain by turning it off — it just floods the canvas.
  Shipping an option whose only outcome is a broken result is worse than not
  having it.
- **Lens masks** on pattern layers (`planet` / `lens` / `outside-lens` + feather)
  for the overlap patches in the reference. One SVG `<mask>` covers all three
  cases plus the soft edge; nested clip paths cannot.
- **Five Planet style recipes** that rewrite planet mode, shading and layer
  visibility *together*, because the reference looks are combinations rather than
  single settings. `detectPlanetStyle` reports `custom` honestly when nothing
  matches — including the shipped default.
- **`DOC_VERSION` → 2** with `normalizeDoc`. Older documents are **migrated, not
  discarded**: presets store whole documents, so discarding on version mismatch
  would silently delete the user's saved presets.
- **Fixed — all-dark planets.** `dealRamp` could wrap past the light end of the
  palette back into the dark slots, producing a planet that rendered as a black
  hole on a dark background (seed `e5`/violet-drive). Runs are now contiguous,
  non-wrapping, and nudged to reach the light end.

---

## v1.0.0 — 2026-07-29

Initial build (`147f6f9`, tagged `v1.0.0`). 70 files, 14,938 insertions.

### Architecture decisions

- **A single inline `<svg>` is the source of truth.** SVG export clones and
  serializes that live DOM node rather than re-rendering; PNG export rasterizes
  the same string. This forbids editor-only CSS and any CSS-only paint, and it is
  the constraint the rest of the design bends around.
- **Conic gradients are wedge geometry, not `conic-gradient`.** SVG has no conic
  gradient and a CSS one would not survive serialization, so the sweep is N wedge
  paths with fills interpolated in OKLab. Preview and export stay identical
  instead of the export falling back to something else.
- **The shading group carries no `opacity` attribute.** Group opacity would
  isolate it and stop the terminator shadow multiplying against the planet
  beneath. Children carry their own blend and opacity instead. This looks like an
  oversight and is not.
- **Every colour is a `ColorRef`** (`{ slot, hex?, alpha? }`), never a raw hex, so
  switching palettes recolours the whole composition. Slot ordering
  (darkest → lightest) is a contract the remix deck depends on.
- **Background and planet base are fixed below the layer stack.** The brief listed
  them as reorderable, but moving either above the pattern layers can only hide
  them. Accents *are* in the stack — that is the case where order earns its keep
  (an accent below the patterns puts a ring behind the planet).
- **Locks consume their RNG draws even when locked**, so toggling one lock does
  not shift what the others produce.

### Pattern pipeline

`Patterns/` is the source of truth; the duplicate SVGs loose in the root folder
are deliberately not globbed. **There are 17 files, not the 18 the brief stated.**

Each file becomes a recolourable template: colour literals become `%%cN%%`
tokens, unique colours cluster in OKLab into ≤8 assignable groups, ids are
namespaced, and the full-bleed background plate these Figma exports open with is
detected so it can default to hidden.

- `<mask>`, `<clipPath>`, `<pattern>`, `<marker>`, `<filter>` subtrees are
  **skipped** — recolouring the white inside a luminance mask destroys the mask.
- Within a group each colour keeps its **lightness offset from the group mean**,
  so a pattern built from gradients still reads as a gradient after being mapped
  onto one palette slot.
- `pathIsFullBleed` is conservative on purpose (single rectilinear subpath only);
  several files open with a huge multi-`M` path that would otherwise be misread
  as a plate.

### Fixed during the build

- **Conic wedge radius** used the box diagonal, which under-covers once the focus
  moves off-centre. Now measures to the farthest corner *from the focus*.

### Retuned after additional reference images

The first pass used low-opacity soft-light washes. Supplied references showed the
ink should be **crisp** — flat colour, `normal` blend, high opacity, large scale.
Defaults and remix weighting were retuned accordingly, and a **Signal Dark**
palette added to match the brand-system board.

### Verification approach

No automated tests — this is a visual tool, and correctness means "it looks right
and the export matches the preview". The Chrome extension tools are not connected
on this machine, so verification drives Chrome from the CLI
(`--headless=new --screenshot`, `--virtual-time-budget` to wait,
`--dump-dom` to extract generated data out of the page). Temporary QA routes
render grids of variants for a single screenshot, then get deleted.

Export parity is checked as a triptych — live preview vs. standalone `.svg` vs.
rasterized `.png` — plus `xmllint` and a check that no external references or
leftover tokens survive.
