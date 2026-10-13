# Changelog

A record of what changed and **why** — decisions, the reasoning behind them,
things that were tried and abandoned, and bugs with how they were found. Commit
messages cover the what; this file exists for the parts that would otherwise be
lost, so the next person (or the next session) does not re-litigate a settled
choice or re-introduce a fixed bug.

Newest first. Keep entries honest: record reversals and dead ends, not just wins.

---

## Unreleased

### Fixed: photo and texture cells mis-masked on Figma import

Pete's Figma imports showed a photo cut to a vertical strip of its cell and
a texture cut along a vertical edge, in an orb whose real cell boundaries are
all tilted. Flat/ramp cells (plain paths since the earlier Figma pass) were
right, so the culprit is Figma's `clipPath` import. Both cell kinds moved to
the structures Figma's *own* SVG export writes — so its importer round-trips
them — and both verified render-identical in the browser (SVG vs PNG):

- **Photo cells are the cell path with an image fill**: an
  objectBoundingBox `<pattern>` holding a `<use>` of an `<image>`, exactly
  Figma's export form. No clip at all; in Figma it is one shape whose image
  crop is editable. Needs the cell's exact bounding box, so
  `circleRectIntersectionBBox` computes it analytically (rect corners in the
  circle, edge/circle crossings, circle extremes inside the rect).
  `expandPatternFills` only rewrites `rect` fills, so it leaves these alone.
- **Texture cells use an alpha `<mask>`** (`style="mask-type:alpha"`,
  Figma's masked-group export) instead of a `clipPath`. Still one level,
  never nested; batch cells (CSS-scaled) checked.

Not verified inside Figma from this session — the importer is not
scriptable here. If a mask still lands wrong, the next step is Figma's
plugin `createNodeFromSvg` via the bridge, which uses the same importer.

### Changed: texture cells always carry a background

Remix dealt a texture cell's plate only half the time; transparent plates
read as holes (in Figma, as missing cells). The coin is still drawn and now
picks *which* ground: a dark plate with light/mid ink, or a light plate with
dark/mid ink — same draws, stream unchanged, but existing seeds' texture
cells change look. The 5 of 55 patterns with no plate of their own get a
ground painted under them from the palette end opposite their inks. A
texture chosen by hand in the cell editor starts with an opaque plate.

### Added: the full-page photo library, with app-level curation

Pete wanted the photo library as its own page, operating at the app level
like the pattern library, for picking favorites/selects and setting focal
points site-wide. Header → **Photos** opens it (the three full-page panels
now close each other):

- A grid of the whole library with views (selects / favorites / all /
  hidden), a folder filter and search; a detail pane with a large focal
  point picker on the full image, default zoom, Favorite (F), In pool (P),
  Hide (H), reset to the detected focal point; ← → step through the view.
- **Curation is app-level** (`lib/photoPrefs.ts`): favorites, hidden, and a
  per-photo framing override. Saved to localStorage and, where the library
  is served, to `photo-library/prefs.json` (dev server and orbgen both
  accept a PUT of exactly that file) — so the API and MCP tools use the same
  favorites, hidden list and framing as the editor.
- **Framing is site-wide**: reframing a photo anywhere (library page, pool
  card, cell) updates the override and reframes it in the open document.
  Documents still snapshot framing in their pool/cells so presets and API
  runs reproduce. Known gap: undo reverts the document's framing but not the
  site-wide override.
- The sidebar's Photos section shrank to the pool: thumbnails with focal
  marks (drag to reframe), the per-orb range, "+ N favorites", upload, and
  a button into the library page.
- API/MCP: `library.favoritesOnly` / `library_favorites_only`,
  `favorites_only` on `list_library_photos`; hidden photos are never
  picked; site-wide framing is the default framing.

### Added: the photo pool (replaces the single kept photo)

Pete wanted a pool of photos, each with its own focal point, that Remix uses
to fill *different* segments with *different* photos. `doc.featuredPhoto`
became `doc.photoPool: { photos: PoolPhoto[], min, max }` — the same
standing-preference citizenship. `normalizeDoc` migrates a kept photo into a
one-photo pool (tested).

- **Placement** (`placePoolPhotos`): a count drawn in [min, max]; each placed
  photo is a different pool photo in a different non-fill-locked cell,
  wearing its pool framing. A fill-locked cell already showing a pool photo
  counts toward the total and that photo is not repeated.
- **Room for photos:** when the rolled structure has fewer cells than `min`,
  the rows grow (A first, alternating, ≤3 each) unless the structure is
  locked — pure selection, since cell candidates are drawn at full width.
- **Stream:** still the separate `${seed}-photo` stream, drawn at full width
  (6 cell + 6 photo picks, then the count). Cell pick 0 comes first, so a
  one-photo pool reproduces the single kept photo's placements exactly.
  The main stream is asserted untouched for 1- and 3-photo pools.
- **Framing belongs to the photo** while it is pooled: editing focus/zoom in
  a cell or a pool card reframes the pool entry and every cell showing it,
  in one undo entry.
- Tests: distinct photos + per-photo framing, row growth, pinned photos,
  stream invariance, migration — the first two confirmed failing under
  sabotage.

### Added: the local RSAC photo library (`photo-library/`, untracked)

Seeded from the client's 2025 and 2026 conference photo folders in Dropbox:
~5,900 JPEGs, 39 GB. Copies are local-only — gitignored, never deployed,
because the repo is public and these are a client's photos.

- **Built once by `tools/photo-library/build.swift`** (ImageIO + Vision):
  ≤2048 px JPEGs with EXIF orientation baked in and *metadata stripped*
  (originals carry GPS and camera serials), 320 px thumbnails, and a catalog.
  4,935 photos, 3.0 GB, ~55 photos/s on 16 cores.
- **Dedupe by file name + aspect within a source**, larger original wins,
  folder tags merged. The first pass keyed on name + pixel size and merged
  almost nothing: the "selects" folders are smaller re-exports of the
  "Final High Res" files. Different aspect = a real crop, kept separate.
- **Face-detected focal points** so 4,935 photos need no hand framing:
  anchored on the largest face, averaged only with faces ≥ half its size
  within three of its widths. Plain area-weighted averaging (first try) put
  the point on the empty wall between two people in a two-shot.
- **The app loads it lazily:** the catalog (metadata + thumbnail URLs) loads
  up front; a full image loads only once the pool or a cell references it.
  Holding thousands of data URLs in memory, as uploads are, would not work.
  Served by a Vite middleware (dev + preview, not the build) and by orbgen.
- **Photos section** (new 02; later sections renumbered): pool cards with a
  focal-point picker and zoom, the per-orb range, multi-file upload, and a
  paged library browser (folder tag, search, selects-only, "+ 12 random").
  The cell editor's photo dropdown lists only pool photos and uploads.
- **API/MCP:** `photos` (paths, URLs or library ids, each framed),
  `library_tags`/`library_search`/`library_count` (seeded picks),
  `photos_per_orb_min/max`, and a `list_library_photos` tool. The run log
  records photo sources, not bytes.

### Added: orbgen — REST API, MCP server and Figma bridge (`tools/orbgen`)

Pete wanted orbs created and placed in Figma programmatically. Three layers:

- **`api.html` / `src/api.tsx` (`window.orbgen`)** renders with the app's own
  `OrbSvg` and exports with the same `serializeSvg`/`rasterizeSvg`, so API
  output is byte-identical to an editor export. Rendering in Node (jsdom +
  react-dom/server) was rejected: pattern parsing needs `DOMParser`, tile
  expansion needs `getBBox`, PNG needs a rasterizer — a Node path would be a
  second renderer that drifts. Shipped in the build (second Vite input).
- **`tools/orbgen` service** drives one long-lived headless Chrome over CDP
  (real time — virtual time hangs image decode and IndexedDB), serves
  `dist/` itself, and exposes a localhost REST API. Calls are serialized:
  concurrent runs in one page would share `o1-…` def ids and paint with each
  other's gradients. The MCP server (stdio, `.mcp.json`) owns the port or,
  if another orbgen holds it, forwards to it — one address for the plugin.
- **Figma plugin "Orb Generator Bridge"** (development plugin). Placement
  goes through it rather than through an agent writing Figma plugin code:
  orb SVGs are 15 kB–several MB (photos, expanded tiles), far too large to
  relay through a model's context. The plugin UI long-polls the service and
  places each job as a named grid frame via `createNodeFromSvg`. "Connected"
  means a poll is open now — a time window reported a closed plugin as
  connected for most of a poll.

Verified end to end except inside Figma itself: REST, MCP (both modes) and
the bridge protocol with a stand-in plugin. `createNodeFromSvg` placement has
not been exercised in Figma from this session.

### Changed: a photo's focal point aims at the cell's centroid

With Remix placing the kept photo into any cell, the old `object-position`
mapping (focal point → same fraction of the cell's bounding box) cropped the
subject in wedge and rotated cells, where that spot can fall outside the
visible shape (seen in an API contact sheet: the target half-hidden in 2 of
4). The focal point now aims at the cell's area centroid (grid-sampled),
clamped so the photo still covers the box. Existing photo cells shift
slightly toward their cell's center of mass.

### Fixed: Remix in Batch mode did nothing

Each batch cell is `remix(doc, batchSeed-i)`, and remix re-deals every
unlocked value from the seed alone — so remixing the document under unchanged
batch seeds re-rendered the same cells. While Batch is open, Remix / R now
deals a new batch (`BatchPanel`'s `regenerate` counter); Remix All also
re-rolls the palette as before.

### Fixed: fill-locked cells could turn invisible on Remix

A fill-locked cell takes inks from the dealt candidate, and the colors lock
cycles the incoming document's inks; either source can be a texture's hidden
plate (alpha 0), which made a flat cell vanish (found while writing the
kept-photo tests). `transplantRefs` now carries only visible inks, and keeps
a texture's hidden groups hidden. `withRefs` still restores a color-locked
cell's own refs exactly. Two tests, each confirmed failing without the fix.

### Added: a kept photo that Remix and Batch build around

Pete wanted to upload a photo and then use Remix and Batch to generate many
options that all include it. The first photo-cell cut (below) protected the
photo by fill-locking its cell — which *also* pinned the whole structure
through existence implication, so every remix was the same split with the
photo in the same cell. **Reversed the same day:** choosing a photo no longer
sets a fill lock.

Instead `doc.featuredPhoto` (`{ photoId, zoom, focusX, focusY }` or null) is a
standing preference, same citizenship as `colorSource`: survives remix via the
spread, not a lock, not in `doc.locks`. When set, remix:

- steers an unlocked orb type to `segments` (a selection over the draw already
  made — a photo needs a cell to live in; a locked type wins, and the photo
  just waits);
- deals the structure and cells as usual, then places the photo in one cell
  that is not fill-locked (`placeFeaturedPhoto`). A fill-locked cell already
  showing that photo means "pinned here" — nothing is added.

The cell pick comes from a **separate `${seed}-photo` RNG stream**, so the
main stream is untouched: a seed deals the identical composition with or
without the photo, differing in exactly one cell — asserted in
`remix.test.ts`. Sabotage note: moving the pick onto the main `rng` at its
current position does *not* fail the test, because it would be the last draw
and shifts nothing; a conditional draw earlier in the stream does fail it.
The separate stream is what keeps that true if draws are added later.

UI: choosing "photo" or uploading into a cell makes it the kept photo when
none is kept; editing a kept cell's framing updates `featuredPhoto` in the
same undo entry; "Keep in remixes" on the cell and "Keep photo" in the Orb
section's chip row turn it off. Deleting the photo from the library clears it.

### Added: photo segment cells

Pete asked to upload a photo into a segment cell, with zoom and a focal
point. A fourth `SectorFill` kind, `photo`: `{ photoId, zoom, focusX, focusY }`.

- **Storage is IndexedDB (`lib/photos.ts`), and the doc holds only the id.**
  One photo would blow the shared localStorage budget, and keeping bytes
  out of the doc keeps undo history, presets and remix cheap. Photos are
  downscaled at import (3200px long edge; JPEG 0.88, PNG stays PNG).
  Known limit: exported preset JSON carries the id, not the photo, so a
  photo cell only renders in the browser that has the photo.
- **The renderer embeds the photo as a data URL** (`xlink:href`, the form
  older importers read). That keeps SVG export a pure serialization — the
  photo travels into Figma — and lets PNG rasterization load it, which an
  SVG-in-`<img>` cannot do with blob: or external URLs.
- **Positioning is CSS `object-fit: cover` + `object-position`** over the
  cell's visible box: the focal point lands at the same fraction of the
  cell, so it can never be cropped out at any zoom (1–4 in the UI, 8 in
  the renderer). The photo stays upright when the split structure rotates.
  One clip per cell, same as texture cells (never nested).
- **Remix never deals a photo, and choosing "photo" sets the cell's fill
  lock.** *(Superseded by the kept-photo entry above — no longer auto-locks.)* Without it the next Remix would re-deal the cell and the photo
  would vanish from the composition. The lock is visible and can be opened;
  this is the UI choosing a default for the user, not remix special-casing
  photos — remix treats it like any other locked cell, and existence
  implication then pins the structure. `refsOf` returns no inks for a photo,
  so the colors lock and Shuffle colors pass over it.
- Focal-point drag and zoom slides coalesce into one undo entry each
  (`SectorRowEditor`'s `onChange` now carries a coalesce key).

QA note: under headless `--virtual-time-budget`, `createImageBitmap` and
IndexedDB never resolve (same family as the rasterizer stall below). The
real upload path was verified by driving Chrome over CDP in real time.

### Changed: SVG exports import into Figma with far fewer mask groups

Pete flagged a Figma import of a segments orb as hard to work with: every
cell sat in a "Clip path group" whose mask was named
`bbatch…-secclip-0-1`. Three changes, all verified pixel-equivalent
(live vs exported, ≤29 of 40k pixels differing per orb — antialiasing):

- **Flat and ramp cells paint their exact cell∩circle path** with no clip
  (`circleRectIntersectionPath`, which texture cells already used). The
  "Sector cells" group imports as plain named shapes. `rotatedRectPath`
  had no callers left and was deleted. This is a renderer change, not an
  export rewrite, so preview and export stay one code path.
- **Clip and mask defs are renamed after the layer that uses them**
  (`Sector_A2_W_Pennants_clip`, `Pattern_X_mask`; the shared orb circle is
  `Orb_clip`), since Figma names the mask layer after the clipPath id.
  Defs also reached via `style` or `href` are left alone — those
  references are not rewritten. Unreferenced clips/masks are dropped.
- **Expanded pattern tiles only get a tile clip when the content overhangs
  the tile.** Measured with getBBox in an offscreen svg, grown by 2× the
  widest stroke (getBBox ignores stroke; 2× covers a miter at limit 4).
  Errs toward keeping the clip. In a sweep of all 39 patterns at default
  tile scale, 22 no longer need per-tile clips — previously each tile was
  its own mask group in Figma.

Remaining clips are the irreducible ones: one per texture cell, the orb
clip on pattern/shading/accent layers, lens masks, and tiles of patterns
that genuinely overhang. QA note: in-page rasterization (`rasterizeSvg`)
hangs under headless `--virtual-time-budget`; compare live `<svg>` against
an `<img>` of the export in a screenshot instead.

### Fixed: segment cells never dealt the curated file patterns

The user noticed some patterns rarely surfacing in batch — a 400-remix
audit confirmed it structurally: dealFill preferred the tx- procedural
pool whenever any existed, so 0 of 31 file patterns appeared in 228 dealt
texture cells. The preference predates the curated library (it guarded
against the heavy geometry grids); now that the Library's include-toggles
are the curation surface, cells deal from the whole enabled pool
(31/31 + 24/24 in the re-run). Same draw counts, so the strict remix
invariant is untouched; segment-cell picks shift for existing seeds.

### Changed: staging-review polish, second round

Palette JSON export/import moved behind the Palette section's
more-settings (interop, not a reacting surface). Padlocked slider pairs
(Center X/Y, layer offsets, cell scale/rotation) stack vertically — two
columns plus a padlock broke the 348px frame. The phantom page scrollbar
is gone (.sidebar became the containing block for its visually-hidden
file inputs). Passive blend/mask tags on layer cards are buttons that
open that card's advanced scope.

### Added: the shipped default preset — RSAC Collage Spectrum

The sole curated builtin (exported from staging 2026-08-25, seed
dusk-pulse-932, revised the same evening): the segments collage on RSAC
Spectrum with color via the named brand gradients, flagged default, so a
brand-new visitor's first document is the brand look rather than a
hard-coded composition. An earlier RSAC-Main variant was replaced by the
product owner's pick. Preset loads now run through normalizeDoc on every
load (builtins ship raw in code and user presets may predate the current
doc version). The passive blend/mask state tags on layer cards became
buttons that open that card's advanced scope — state you can see is now
state you can reach.

### Added: shipped presets, a default-preset seed, and preset export/import

BUILTIN_PRESETS (lib/presets.ts) follows the BUILTIN_PALETTES pattern:
curated documents baked into the build, visible to every user (starred in
the picker, not deletable), with one optionally flagged default — a brand-
new visitor's first document is that preset; returning visitors keep their
own. The header gains export (your presets as JSON — the hand-off that
turns a staging composition into a shipped builtin) and import (the same
file back in anywhere; docs run through normalizeDoc so old exports keep
loading). Presets remain per-browser at runtime by design — shipping one
is a deploy, which fits a curated brand set and would not fit live
team-shared presets (that needs a backend this app deliberately lacks).

### Changed: orb position ships locked at canvas center

DEFAULT_SUBLOCKS.orb.position is now true: a fresh document sits at 0.5/0.5
and remix keeps it there; compositions drift off-center only when someone
deliberately unlocks the pair. Migrated pre-v4 documents get the same default
(freezing whatever position they had); v4 documents that already stored the
sub-lock keep their own setting.

### Added: the pattern library manager (header → Library)

Curates what generations deal from: every pattern — 18 built-ins, the
procedural textures, imports — as a thumbnail with an include toggle, plus
"Add SVGs…" (the global drag-drop's discoverable twin) and delete for
imports. Stored as an exclusion list so newly added patterns default in.
Non-destructive on purpose: parsing is never filtered, so existing
compositions keep rendering excluded patterns and pickers show the in-use one
as "(excluded)"; only the remix pool and the pickers' offer lists narrow.
Verified in-browser: exclusions persist, and with the pool cut to a single
pattern four consecutive Remix Alls dealt only it.

### Added: batch "Copy for Figma" — the whole collection in one paste

Each cell also carries its own **Figma** button beside Promote, copying that
one orb without loading it into the editor — same serialization as the
single-orb path, toast named by seed.

Each rendered batch cell is serialized exactly like its single-file export
(tiles expanded, layers named) and nested as an `<svg x y id="orb-<seed>">` in
a near-square grid with an 8%-of-canvas gutter, under one root svg. Per-cell
id prefixes keep every `url(#)` target unique across the combined document —
verified in-browser on a 9-cell copy — while layer-*name* ids deliberately
repeat, so every pasted orb carries identically-named layers. Figma flattens
each nested svg into its own named group.

### Added: "Copy for Figma" — the clipboard paste path, first-class

Figma parses SVG markup straight off the clipboard into editable layers, and
the serializer was already built for that import (expanded pattern tiles,
data-name → id layer names) — but the copy button lived in the Export advanced
tier and followed the expand-tiles checkbox, which could silently strip
textures from a paste. "Copy for Figma" is now the Export section's primary
action: always expands tiles regardless of the checkbox, same serialization as
the downloads, toast says what to do next. Verified in-browser: the copied
payload has no <pattern> fills, carries named ids, leaks no data-* attributes.

### Changed: per-scope disclosure replaces the global Advanced mode (staging review)

The app-wide Simple/Advanced toggle shipped and was rejected the same day —
"advanced" is a property of the thing being edited, not of the session. Every
section and every card (segment cell, pattern layer) now carries its own
"more settings" toggle (a drawn sliders icon) beside its locks, revealing that
scope's deep controls in place; a card inherits an opened parent scope so the
wider toggle never closes a card back down. Disclosure state is ephemeral on
purpose. Sidebar hierarchy rebuilt in the same pass: cells and layers are
headed cards on a sunken ground (name + state hint + tools in the head), group
eyebrows carry a rule, so which-controls-apply-to-what reads at a glance.

Bugs found by the same review, all fixed with regression coverage where the
suite can see them:

- **Type switching was blocked by its own lock.** `applyOrbType` treated the
  Type segmented as a macro and refused under `locks.orb`/`orb.type` — but
  locks guard randomizers, never the user's own hand. The switch now always
  lands and the lock pins the *new* value against remix (test updated to
  assert exactly this).
- **The palette dice defeated "Keep palette".** It only checked the full
  colors lock; the `colors.palette` sub-lock now pins it too, with a toast.
- **A fully transparent ink looked like a broken color picker.** Plates ship
  at alpha 0 by design; the editor now announces "hidden · alpha 0" with a
  one-tap "show" wherever the alpha slider isn't on screen.

Verified by an interactive Playwright sweep (20 checks: hand-edit-vs-lock
semantics, existence implication through the orb dice, canvas quick-picks,
undo, per-scope reveals, brand strip application, typed-seed reproduction,
shuffle geometry invariance, batch open) with a clean console.

### Changed: v4 — the mode-first restructure (orb types, the lock tree, RSAC brand)

The whole release follows the product owner's five-step workflow (2026-08-25):
choose size+type of orb → palette drives the collection → mode-dependent
editing with per-segment/per-layer locks → accents their own section → simple
canvas. Decisions recorded that session: **sliced retired entirely**, **accents
decoupled from orb type**, **one-time seed break accepted**, **brand gradients
hex-exact**. The remaining design questions ship on the proposal's leans
(Q7–Q12 in the design artifact).

- **`orbType` replaces `orb.mode`.** `color` | `pattern` | `segments`; the Orb
  panel renders only the chosen type's controls. Sliced is deleted — renderer,
  config, remix dealing — and `normalizeDoc` (DOC_VERSION 4) migrates sliced
  documents to `color`, keeping the gradient. That look-change is deliberate.
  A "flat color" fill is a two-stop constant gradient, so there is still only
  one fill render path.
- **The lock tree.** Section locks → sub-locks (`orb.type/size/position/
  structure`, `patterns.count` absorbing `lockPatternCount`, `colors.palette`)
  → per-object property locks on pattern layers and segment cells. The
  existence problem ("what does a locked cell mean when remix re-deals the row
  to fewer cells?") is resolved by **existence implication**: a lock on a child
  implies the lock that keeps the child existing, derived at remix time and
  never stored. Dormant positional locks were rejected (a lock remix can
  delete is a trust betrayal); identity-carrying cells were rejected (cell
  geometry is positional by design).
- **Fixed-width remix.** Candidates are always drawn at maximum width and
  counts always rolled; every lock at every level is pure selection. This made
  the determinism invariant *strict* — the grandfathered `lockPatternCount`
  draw-count exemption is gone — at the cost of a one-time seed break
  (accepted; seeds are session reproducibility, not archival). Accents remix
  under every orb type now; the anti-astronomy retirement rule is deleted.
  Remix also no longer force-shows a hidden orb — Hide orb is a standing user
  choice.
- **Simple/Advanced tier.** One global toggle (sticky, persisted in UI state,
  returning profiles grandfathered to Advanced). Simple = the remix loop;
  Advanced = everything, interleaved in place. Two primitive rules carry most
  of it: ColorRefEditor's hex override + alpha and GradientEditor's per-stop
  editing are Advanced. Hidden-but-rendering state (masks, blends) surfaces as
  passive notes in Simple.
- **RSAC Brand System** (`lib/brand.ts` + three `BUILTIN_PALETTES` entries).
  RSAC Neutrals (8 slots, the new default palette — "the brand leads with
  black and white"), RSAC Spectrum (12), RSAC Main (6). The ten named
  gradients are **hex-fixed presets** — named brand assets whose identity is
  their stops; the nearest palette slot rides along as graceful degradation.
  Contrast's overshoot stops are resampled to effective 0%/100%; the Logomark
  gradient ships `reserved` and appears in no picker. Eight gradients chain
  end-to-start, so the picker is the **Spectrum Strip** — one continuous band
  plus Energy/Contrast cross-link chips. `doc.colorSource` ('palette' |
  'gradients') is a third standing preference: remix delivers color through
  the named gradients when set, stream-safe because both candidates always
  draw. The Canvas WHITE quick chip writes Off White #FDF9F6 under RSAC
  palettes (the brand's light ground), literal white elsewhere.

### Changed: the site now lives at https://orbs.fnfn.us/

Custom domain on the existing GitHub Pages deploy, three coupled pieces:

- **Cloudflare CNAME** `orbs` → `finalfinalff.github.io`, deliberately
  **DNS-only (grey cloud)** so GitHub provisions and renews the TLS cert.
  Proxying it orange-cloud during initial setup can stall GitHub's cert
  issuance; if someone later wants Cloudflare features on the hostname, flip it
  after the cert exists and know that cert renewals depend on GitHub still
  being reachable for validation.
- **Pages custom domain** set in repo settings (via API) *and* mirrored in
  `public/CNAME`, which Vite copies into `dist/`. With workflow-based deploys
  the settings value alone suffices, but the file keeps the domain
  self-describing in the repo and survives Pages being re-enabled from scratch
  (the `enablement: true` path in deploy.yml).
- **`base` changed `/planet-generator/` → `/`** because a custom domain serves
  from the domain root, not the repo slug. The old warning ("only change base
  with a repo rename") is superseded: base now pairs with the *domain*, and
  reverting the domain means reverting base in the same change. The old
  `finalfinalff.github.io/planet-generator/` URL 301s to the domain, so
  existing links keep working.

### Added: semantic layer names in exports (Figma editability, part 1)

New requirement: exports must open in Figma fully editable. First finding from
auditing real batch exports: the constructs we emit (paths, rects, circles,
ellipses, polylines, groups, clipPaths, linear/radial gradients, standard blend
modes) all map to editable Figma layers — but the tree would land as anonymous
"Group / Vector" soup, which costs as much editability as a dropped fill.
Figma reads the SVG `id` attribute as the layer name on import, so `OrbSvg` now
marks logical layers with `data-name` and `serializeSvg` converts those to ids
on the export clone (NCName-sanitized — ids cannot contain spaces — and
deduplicated). Verified end-to-end through the batch/zip harness: exports carry
`Background`, `Orb_disc`, `Sector_B1_Dither__Sparse_Scan`, `Pattern_Dot_Bloom`,
`Ring`, `Satellite`; no `data-*` leaks.

Also verified this round: the store-only ZIP writer passes `unzip -t` with v2
documents, including a 2.9 MB expanded sector-texture file.

Still open (needs a live Figma session, which needs the user): empirical import
of the two staged test files, checking (1) whether the lens `<mask>` — luminance
with a gradient feather — survives, and (2) `mix-blend-mode` fidelity. If masks
fail, the candidate fix is a Figma-safe export path converting lens masks to
exact circle∩circle clip geometry (feather dropped, editability kept).

### Added: `solidFills` — the gradients-off standing constraint

Client follow-up to flat-first: gradients themselves can read as spherical 3D
rendering (a radial ramp on a disc is a lit sphere in all but name). New
document flag `solidFills`, built as flat mode's sibling: render-side only —
`OrbSvg` collapses every smooth gradient to its own ramp's midpoint ink
(`solidFor`) — so toggling it off restores every gradient exactly, and remix
carries it with zero special casing via the `{ ...doc }` spread.

Scope decisions: the vignette is suppressed too (it is a smooth radial blend,
which is exactly what the toggle removes — flat mode keeps it because flat is
about sphere *cues*, not blends). Sliced bands stay (discrete ramp samples,
already flat fills), and pattern-internal gradient spreads stay (they are the
artwork's texture, not a document fill). Kept independent of `flat` rather
than folded into it: gradients read as sphere surfaces, shading as sphere
lighting, and the client may want either gone without the other. Orbit rings
and satellites were explicitly kept, per the same feedback round.

`remix.test.ts` gained a `solid fills` block mirroring the flat-mode contract
(survival + changes-nothing-but-the-flag), sabotaged once to confirm it bites.

### Added: second texture wave, mined from the older reference boards

Four more generators in `src/lib/patterns/textures/`, sourced from `Examples/`
material that predates the 2026-08-25 comps: **wave** (op-art sine/zigzag rule
fields — the `c4926aa5` poster and two panels of the `d8a9d0db` board), **dots**
(halftone grids with ping-pong size ramps — the board's dissolving-dot panel and
the `abfd55d93` halftone arcs), **stipple** (seeded organic spatter with
clustered placement and polygon splats for the large spots — `image 20`'s paint
speckle, which is also the grain in the client comps that dither's blocky
glitch never matched), and **hatch** (45° pinstripe families with density
banding and a crosshatch weave — the board's bottom panels).

Considered and dropped: the board's offset-brick stripes and diagonal shards —
steps and dither already own that territory, and near-duplicate textures just
dilute the remix pool. Same architecture as the first wave (ordinary pattern
sources, same contract), so registration was one import block in
`procedural.ts`. Tiling notes worth keeping: a dot-size ramp only tiles if it
ping-pongs; a 45° hatch only tiles when its stripe offsets are periodic in
x±y mod the tile; wave fields need whole wave/envelope/phase periods per tile.
The library is now 18 file patterns + 23 procedural variants.

### Changed: v2 goes flat-first — remix and defaults stop producing rendered lighting

Client feedback on the Phase 3 remix grid: disc-mode results still came out as
shaded spheres with terminators and highlights — the literalness v2 exists to
retire. The fix is a stance, not a mode:

- **`defaultDoc` ships the shading layer invisible and the rim light disabled.**
  Both keep their tuned values, so the layer toggle and the `shaded-sphere`
  style land somewhere sensible when someone opts back in.
- **Remix never turns shading or the rim *on*.** Their values are still dealt
  (the RNG stream is unchanged — visibility is a pure selection), but
  `visible`/`enabled` follow the incoming document. A flat document stays flat
  through any number of remixes; a legacy document that has shading visible
  keeps remixing it, because that is the user's own setting.
- **Only `shaded-sphere` reintroduces shading.** `patterned-disc` and
  `overlap-bloom` now set it invisible — the crisp ink and the lens overlaps
  carry those looks, matching the image 40 reference discs.

Deliberately NOT done: forcing `doc.flat` (a standing user constraint remix
and styles never write) and removing orbit rings from disc/sliced remixes (the
complaint was lighting; orbits are a separate conversation if they come up).

The abstract direction's print vocabulary, built as four generators in
`src/lib/patterns/textures/` — concentric rings, radial rules, vertical-bar
dither, stepped density stripes — each authored against a reference image and
verified by screenshot (the tileable two seam-checked as 2×2). Decisions:

- **Textures are pattern sources, not a new subsystem.** Each generator emits a
  plain SVG string satisfying the parse contract (full-bleed plate, hex-literal
  inks, drawable elements only), and `procedural.ts` registers the curated
  variants as `PatternSource`s. Everything else — palette-slot mapping, pattern
  layers, imports-style listing, remix reach — came for free. The four
  generators were built by four parallel agents against that written contract;
  all four came back drop-in compatible.
- **Sector texture cells inline recolored markup; they never paint via
  `<pattern>`.** `expandPatternFills` only rewrites `rect` fills, so a
  pattern-filled cell `<path>` would silently lose its texture in a Figma
  import. Inlining is export-safe by construction. Verified by extracting a
  remixed collage's `<svg>` from the QA page and rendering it standalone —
  identical.
- **Cell clipping is one exact path, not nested clips** (see the Phase 1 entry
  for the Chrome scaling bug): `circleRectIntersectionPath` computes cell∩circle
  analytically. The trick that keeps it tractable: the sector structure rotates
  about the circle's own center, so the circle is invariant — intersect an
  axis-aligned rect with the circle in the unrotated frame, then rotate the
  emitted points/arcs.
- **Remix**: mode roll is now disc/sliced/sectors weighted `[0.36, 0.14, 0.5]` —
  the brief asked for abstract at least as often as legacy. Sector config draws
  happen unconditionally (like the slices) with the colors lock applied as pure
  selection (previous fills' ColorRefs re-mapped over the drawn structure).
  Three tunings from the remix contact sheet: flat cells never deal the ground
  slot (a bg-colored cell reads as a bite out of the disc); plate-off texture
  cells draw ink from the light deck only (dark ink on the dark canvas made
  whole cells vanish); accents go invisible when the selected orb is sectors
  (orbit rings around a collage read as astronomy).
- **One `sector-collage` style, not three.** Style dropdown entries are
  composition archetypes; the collage's variety comes from remix. The style
  keeps the doc's sector config (as sliced-sweep keeps slice settings) and does
  not set `doc.flat` — flat is a standing user constraint no style writes.
  `detectOrbStyle` maps `mode === 'sectors'` to it unconditionally, mirroring
  sliced-sweep.

### Added: `sectors` orb mode — the abstract direction's structure (v2, Phase 1)

Client feedback on the RSAC refresh: the orbs read as literal planet renderings.
The 2026-08-25 comps (untracked, in `Examples/2026-08-25/`) replace the shaded
sphere with a **sector collage**: the disc cut by one straight chord into two
rows, each row cut crosswise into 1–3 hard-edged cells, each cell filled
independently. This lands as a third `orb.mode` beside `disc` and `sliced`,
additive only — no existing mode, style, default, or remix weighting was touched,
and remix cannot produce `sectors` yet (that arrives with the sector styles).

Decisions worth keeping:

- **Cell geometry is derived, not authored** — cells split a row's width evenly;
  only the chord's angle and offset exist as controls. Same philosophy as the
  slices' derived radii: the reference look never shows bespoke cell widths, and
  per-cell geometry would be nine controls nobody asked for.
- **Ramp fills span the orb's box, not the cell**, so two adjacent ramp cells
  read as parts of one composition instead of restarting at every seam. Ramp
  angle is absolute (canvas space) and does not pick up the structure's rotation.
- **Cells render as pre-rotated absolute paths under a single orb clip — not
  nested clips.** The first implementation nested `clip-path` groups
  (orb ∩ cell-rect). The markup was valid and rendered correctly standalone, but
  Chrome mis-rasterizes nested clip intersections when the host `<svg>` is
  CSS-scaled — square corners escape the disc — and CSS-scaled is exactly how the
  editor stage, the batch cells, and any thumbnail render. Found by screenshotting
  the QA contact sheet (scaled: broken) and the same dumped markup standalone
  (natural size: correct). `rotatedRectPath` in `geometry.ts` bakes the rotation
  into path coordinates so one clip level suffices.
- **`shuffleColors` reaches sector fills**, drawn *after* every existing draw so
  pre-sector documents shuffle byte-identically. Without this, an orb in sectors
  mode looked immune to Shuffle colors. The shuffle test's geometry extractor now
  projects sectors down to angle/offset/cell-counts — fills are colors, structure
  is geometry — and the assertion was sabotaged once (angle+1 in the shuffle) to
  confirm it fails when sector geometry moves.
- **`detectOrbStyle` reports `custom` for sectors** until the sector styles
  exist; claiming `flat-disc` would be a lie the dropdown acts on.
- One process note: a careless `git checkout` during test sabotage reverted
  uncommitted remix edits (the sabotage was done with shell perl instead of a
  tracked edit). Re-applied. Sabotage via real edits, on committed work.

### Changed: the seven hand-authored palettes are commented out

`ember-terminator`, `pale-sky-brights`, `circuit-jade`, `bauhaus-signal`,
`violet-drive`, `oxide-dust` and `signal-dark` are commented out rather than
deleted, leaving only palettes sampled from real source material — the `Palettes/`
boards and the gradient strip. Left in place as a block so they can come back
without being re-derived.

Two consequences to know about:

- **`defaultDoc` starts on a different palette.** It reads
  `BUILTIN_PALETTES[0].id`, not a literal, so a new document now opens on Aurora
  Signal instead of Ember Terminator. Nothing else in `src/` refers to any
  built-in by id string, so that is the whole blast radius.
- **Saved documents and presets pinned to a disabled id fall back to slot 0.**
  `paletteById` returns `palettes[0]` when the id is missing, so an old document
  silently recolors to Aurora Signal rather than failing. Uncommenting the block
  restores it. This is the normal cost of retiring a palette, not a bug — but it
  is why the block is commented rather than removed.

### Added: eleven palettes sampled from the gradient strip

Eleven new built-ins derived from the `Frame*.svg` gradient strip (now copied to
the untracked `Palettes/Gradients/`): Paper Sky, Sky Lilac, Lilac Ember, Ember
Coral, Coral Sunrise, Coral Mint, Mint Gold, Gold Blush, Blush Rose, Rose Navy,
Deep Navy. The frames chain end-to-end into one spectrum, so they are listed in
strip order rather than sorted.

Each source is only a two- or three-stop linear gradient, so turning one into a
palette needed a decision. Sampling six even steps in OKLab gets the hues right,
but **is not sufficient on its own**: most of these strips barely move in
lightness — `Frame` and `Frame-7` span 0.002 in OKLab L — so a straight
six-slot palette has no ground to sit the orb on, no highlight, and gives
`dealRamp` no dark/mid/light thirds to split. The whole composition came out as
one flat wash.

So each palette also carries **derived anchors** at whichever end the gradient
does not already reach: a near-black ground and a mid-dark below (L 0.10 / 0.30),
a near-white tint above (L 0.95), each holding the neighbouring sample's hue at
reduced chroma so the anchor reads as that palette's black rather than a generic
one. `Frame-9`/`Frame-10` already run dark, so they take only a ground and no
mid-dark. That is the same reasoning recorded for the earlier `Palettes/` set
("intermediates were interpolated so the dark/mid/light thirds the remix deck
needs all exist"), applied outward instead of inward.

Two things considered and rejected:

- **Sampling only, no anchors.** Faithful, but Paper Sky and Gold Blush then
  render as a pale disc on a pale background with the orb silhouette invisible.
  The gradients are the palette's identity; the anchors are what make it work in
  a tool whose defaults assume a dark ground.
- **Collapsing the near-identical samples** on the flat strips down to two or
  three slots. Rejected because those strips still travel in *hue* even at
  constant lightness (Gold Blush runs gold→blush), and that travel is the point.

Known and accepted: on a flat strip, some remix seeds deal a ramp whose stops are
all within ~0.002 L of each other and the orb comes out as a near-solid disc.
That is the source gradient showing through, not a bug — a different seed deals a
wider run.

Verified with a throwaway QA route: an eleven-row contact sheet, each palette as
its swatch strip, its default document, and a remix. All eleven produce a legible
orb; route deleted afterwards.

### Changed: renamed "planet" to "orb" throughout (`DOC_VERSION` 3)

Product rename. Everything the tool called a planet is now an orb: `PlanetDoc` →
`OrbDoc`, `PlanetSvg` → `OrbSvg` (file renamed), `Planet` → `Orb`, `PlanetMode`,
`PlanetStyle`, `PLANET_STYLES`, `applyPlanetStyle`, `detectPlanetStyle`,
`planetFilename` → `orbFilename`, the `doc.planet` field, the `locks.planet`
section, the `'planet'` mask mode, the `planet-clip`/`planet-grad` element ids, the
`planet-{seed}.svg` export filename prefix, the window title and the sidebar label.

**Entries below this one are left as they were written.** They describe decisions
made when the thing was called a planet, and rewriting them would misrepresent the
record. Read "planet" in older entries as "orb".

The rename itself was mechanical; the risk was entirely in persisted state, which
a find-and-replace silently corrupts rather than visibly breaking. Three places
needed real migration, and all three fail the same way — the user's work appears
to have been erased:

- **`doc.planet` → `doc.orb`.** `normalizeDoc` reads the legacy field when the new
  one is absent, and deletes it afterward so the two never coexist. Presets store
  whole documents, so this rescues saved presets, not just the working document.
- **`locks.planet` → `locks.orb`, and `mask.mode: 'planet'` → `'orb'`.** Both are
  persisted string literals inside the document. The lock one is the nastier of
  the two: it would not throw, it would just quietly unlock a section the user had
  locked, and a lock is a stated product rule.
- **`planetgen.*` → `orbgen.*` localStorage keys.** Reads fall through to the old
  key and copy forward on first read. The legacy key is deliberately *not* deleted,
  so an accidental downgrade is non-destructive.

`loadDoc`'s shape guard had to be widened to accept `orb` **or** `planet`. Worth
calling out because it reads like a redundant defensive check: left as `!doc.orb`
it rejects every v2 document *before* `normalizeDoc` can migrate it, which defeats
the entire migration while looking correct.

**Verified** with a temporary test file that round-tripped a v2-shaped document
through `normalizeDoc`, `loadDoc`, `loadPresets` and `loadUi`, then sabotaged both
the field fallback and the key fallback to confirm the assertions were not passing
vacuously (5 of 7 failed as expected). Deleted afterward — `npm test` stays the
three contracts named in CLAUDE.md and this is not one of them.

**Deliberately not renamed:** the Vite `base` (`/planet-generator/`), the Pages URL
and the GitHub repo slug. `base` must equal the repo name or every asset 404s on
the live site, so it changes only in lockstep with an actual repo rename. Same for
the `Experiments/Planets` working directory, which is referenced from the global
CLAUDE.md. Historical `CLAUDE-CODE-PROMPTS.md` / `CLAUDE-CODE-FIX-PROMPTS.md` were
left alone for the same reason as the changelog entries below.

### Added: Flat mode, a document-level standing constraint

`doc.flat` suppresses everything that creates the illusion of a 3D sphere while
keeping everything that is genuinely graphic. Distinct from the `flat-disc`
composition style, which is a one-shot macro that also hides patterns and accents:
this is a standing constraint that coexists with any style and any remix.

**What counts as a depth cue, and why.** The shading layer entirely — terminator
shadow, highlight, contact shadow — because each one exists to imply a light
source falling across a curved surface. Plus the accent layer's **crescent rim
light**: it lives in Accents, but it reads as light wrapping a limb, so it goes
while rings and satellites stay. Rings and satellites are graphic marks that would
look the same drawn flat, which is the line being drawn here.

Gradients of every type stay, including radial and conic. A gradient is a flat
graphic device; suppressing them would gut the tool rather than flatten it. **The
vignette stays too**, and that is the one judgement call worth recording: it
darkens the canvas corners, not the planet, and would look identical behind a
square, so it never implies a sphere. Flat mode suppresses sphere shading, not
every soft gradient in the document. The reasoning is repeated in `PlanetSvg` at
the vignette itself, since that is where someone would come to "fix" it.

**Suppression is render-side, not a data mutation** — the central decision.
`PlanetSvg` skips `ShadingLayerView` and the rim crescent (dropping the rim's
gradient def with it, so no dead markup lands in exports). Nothing rewrites layer
data. Two things follow:

- Toggling flat off restores the user's shading and rim settings *exactly*, because
  they were never touched. Verified as a byte-identical round trip.
- **`remix` needs no special casing whatsoever.** This was worth checking rather
  than assuming, and it holds: `remix` returns `{ ...doc, … }` so the flag
  survives, and the shading and rim candidates are still drawn — keeping the RNG
  stream identical, per the draws-always invariant — they just render suppressed.
  The alternative, forcing `rim.enabled: false` or `shading.visible: false` in
  remix, would have been a second mechanism doing the same job *and* would have
  destroyed the settings it was meant to preserve. Same for `applyPlanetStyle`: a
  style may set `shading.visible: true` and that is fine, flat outranks it at
  render time.

**Not a lock.** It stays out of `doc.locks`: a lock freezes a section's values
against randomization, whereas flat changes what renders and leaves values alone.
Conflating them would have implied Remix must not touch shading under flat, which
is the opposite of what is wanted.

`detectPlanetStyle` now treats shading as invisible when flat, so a document whose
only difference from `shaded-sphere` is suppressed shading no longer claims to be
one — it reports `flat-disc`, which is what is actually on screen.

UI: one control, a checkbox beside Composition style rather than in the Shading
header. Flat mode suppresses part of Accents as well as all of Shading, so putting
it in the Shading header would have understated its reach; Composition style is
already the section's documented precedent for a control that reaches outside its
own section. While it is on, the shading controls and the rim controls are shown
disabled with a one-line note, and the Shading section's collapsed header reads
`flat` so it does not merely look switched off. The disabling uses a
`<fieldset disabled>` (`Inert` in `controls.tsx`), not `pointer-events: none` —
the latter only stops the mouse, leaving the controls keyboard-focusable and
editable.

Verified end to end by driving the production build over CDP: with shading, rim,
rings, satellites and patterns all live, toggling flat removed all three shading
defs and the rim while leaving rings, satellites, pattern fills and gradient count
untouched; five Remix Alls brought nothing shaded back; toggling off restored every
cue and the same node count; and a real exported SVG contained no shading or rim
geometry while keeping its gradients. 24 assertions, three consecutive clean runs.

Two traps that made that harness lie before it told the truth, both worth knowing:

- **Seeding `localStorage` and then navigating is a race the app wins.** The
  outgoing page's `pagehide` flush re-saves its own in-memory document over the
  seed, so the run passed or failed depending on which write landed last. Build the
  state through the UI instead.
- **`chrome.kill()` does not always kill the browser.** With a fixed
  `--remote-debugging-port`, a later run attaches to an earlier run's surviving
  browser and inherits its `localStorage` — which ended with flat ON, inverting
  every assertion into 15 confident, meaningless failures. Use a per-run port, and
  assert the preconditions: the script now aborts if flat is not off at baseline.

### Fixed: the batch panel made every slider drag 22× more expensive

**Symptom:** the app would freeze for seconds at a time. **Culprit: the batch
panel, and only the batch panel.** It re-dealt and re-rendered the entire grid on
every single input event, because `cells` keys off `doc` and `doc` is a fresh
object on every slider frame by design. Per input event, with the panel open at
5×5, the app was doing **25 `remix()` calls, 26 full `PlanetSvg` renders and 30
recolors** — and the panel toggles on the bare `B` key, so it is easy to leave
open by accident and never connect the freeze to it.

Measured, production build, 300 input events (what a 5-second 60 Hz drag emits):

| scenario | mean per input event | worst | main-thread total |
|---|---|---|---|
| drag, panel closed | 0.47 ms | 2.4 ms | 140 ms |
| drag, panel open at 5×5 — **before** | **10.22 ms** | 20.0 ms | 3066 ms |
| drag, panel open at 5×5 — **after** | **0.54 ms** | 2.3 ms | 162 ms |

3.07 s of main-thread JavaScript for a 5 s drag is ~60% saturation *before* paint,
with 11.7k DOM nodes to repaint each frame. After the fix a drag with the panel
open costs the same as one with it closed. Dev-mode numbers are consistently 2×
prod (StrictMode double-renders: 19.38 ms → 1.56 ms mean, worst 33.2 → 5.3 ms);
that factor was verified, not assumed, by measuring both.

The fix is three things, all in `ui/BatchPanel.tsx` plus one CSS rule:

1. **`useDeferredValue(doc)` feeds `cells`.** The slider render is urgent and
   keeps the cells it already has; the re-deal runs at low priority once the drag
   stops. Intermediate states are skipped rather than queued.
2. **`BatchCellView` is `React.memo`'d.** Necessary, not redundant: a parent
   render re-renders children regardless of prop identity, so memoizing `cells`
   alone would still have re-rendered all 25 cells. This also forced `register`
   → `onNode`: the old `register(seed)` returned a fresh ref callback per render,
   which would have defeated the memo and made React re-attach every ref.
3. **`content-visibility: auto` on `.batch__cell`** so off-screen cells in the
   scrolling grid skip rendering work.

**What was explicitly *not* the problem.** Recolor/innerHTML churn was the leading
hypothesis and the profile killed it: `resolveTokens` + `recolor` cost **0.02–0.10
ms** per call and **83 ms across an entire 8.5-second drag** with *both* pattern
layers switched to the 325 KB `Geometry Grid 9 1` template — about 1% of the drag.
Memoizing it would have been churn for nothing. No import-weight warning was added
either, and the preview host size was left alone. Do not "optimize" the recolor
path on suspicion; measure first, and note that a 325 KB template is only 687
elements (a few enormous `<path d>` strings), which is why it recolors cheaply.

**Fidelity is untouched, and this was checked rather than asserted.** Every live
`<svg>` — the stage plus all 25 cells — was serialized through the real
`serializeSvg`, in both `expandPatterns` modes, before and after the change with
the document seed *and* batch seed pinned. All 25 cells came out with identical
byte counts and identical canonicalized hashes. The raw hashes differ, which is
expected and not a regression: `nextId()` builds ids from `Date.now()` plus a
global counter, so literal id strings differ on every run no matter what the code
does — hence the canonicalization (rename each id to its order of first
appearance) before comparing.

#### Profiling this app: two traps that cost real time

Both of these produce confidently wrong numbers, so they are worth knowing before
the next performance investigation.

- **Never measure under `--virtual-time-budget`.** Under virtual time
  `performance.now()` *is* the virtual clock, so every duration measures ~0 and
  long tasks never register. A busy-loop sanity check written as
  `while (Date.now() - t < 250)` "confirms" 250 ms because it advances that clock
  by definition — it is self-fulfilling. Virtual time also stalls indefinitely on
  this app (the Vite HMR websocket and the Google Fonts `<link>` both do it), so
  `--dump-dom` / `--screenshot` can hang for 10 minutes on ~3 s of CPU.
- **`requestAnimationFrame` does not loop in headless Chrome** — there is no
  compositor driving frames, so a rAF-paced drag runs exactly one frame. Model a
  drag as discrete input events pumped through `setTimeout(16)` instead, and set
  slider values with the native `HTMLInputElement.prototype.value` setter plus a
  bubbling `input` event, or React never sees the change.

What worked: a temporary in-page driver that scripts the interaction and `POST`s
its report to a local Python collector, with Chrome launched in **real** time (no
virtual time) and `--host-resolver-rules` pointing the font hosts at a dead
address. For screenshots, drive CDP over the Node 24 global `WebSocket` against
`--remote-debugging-port`, poll for a sentinel element, then
`Page.captureScreenshot`. Also: always assert what the driver actually grabbed
(a silent `?? ranges()[0]` fallback measures the wrong control), and keep a
control scenario that burns a known 300 ms so a zero can be distinguished from
"not measured" — that check is what made the all-zero JS timings trustworthy.

The instrumentation itself was removed, per the same rule as the QA routes.

**Known limitation of these numbers:** headless with `--disable-gpu` measures
main-thread JS honestly but does not surface paint/composite cost, so the many
`mix-blend-mode` layers over a large stage are not represented here. If a freeze
is ever reported *without* the batch panel open, that is the next thing to look
at, and it needs a real browser rather than this harness. Relatedly, imported
patterns live only in `localStorage`, so a headless run with a clean profile
cannot see them — a very large dropped SVG remains unexamined.

### Added: a deliberately minimal regression suite (`npm test`)

This repo has no test framework by design — it is a visual tool, and correctness
mostly means "it looks right and the export matches the preview". But three
contracts are invisible to looking at the screen, and each has already regressed at
least once during this project:

- **remix determinism and lock absoluteness** (`src/lib/remix.test.ts`) — same seed,
  palette and locks reproduce the same document; toggling an unrelated lock does not
  shift another section; a locked section is byte-identical to its input through
  `remix`, `remixSection` on other sections, and `shuffleColors`; and locked sections
  keep their stack *position*, not just their contents.
- **pattern parse output** (`src/lib/patterns/parse.test.ts`) — a snapshot of
  template + groups, backed by explicit assertions for the things that actually
  matter: `<mask>` subtrees are not recolored, ids become the `%%ns%%` placeholder,
  gradient stops and `style="fill:…"` *are* tokenized, hostile markup is stripped,
  and fully transparent literals are left alone. The explicit assertions exist so a
  careless `vitest -u` cannot quietly bless a regression the snapshot would absorb.
- **the ZIP writer** (`src/lib/zip.test.ts`) — byte-level walk of the local headers,
  central directory and EOCD, with an independently implemented CRC-32 so the test
  is not merely `zip.ts` agreeing with itself. A malformed archive only fails when
  someone opens it, which is exactly the kind of bug worth a test.

**This is a scoped exception, not the start of a general suite** — recorded in
CLAUDE.md and README so it stays that way. 26 tests, ~350 ms.

Setup notes: `vitest.config.ts` is separate from `vite.config.ts`, which carries the
Pages `base` and the React plugin that tests do not want. Node environment by
default; only the parse test opts into jsdom, via a `@vitest-environment` docblock,
since it needs DOMParser/XMLSerializer. Tests import `describe`/`it`/`expect`
explicitly rather than enabling globals, so `tsconfig.json` needed no change — and
`tsc -b` now type-checks the tests too. Nothing imports them, so they do not reach
the bundle (verified).

Determinism is asserted on **id-normalized** output: layer and gradient-stop ids come
from `nextId()`, a `Date.now()` + counter, not the RNG. Making them seed-derived was
considered and rejected earlier — they are React keys nothing reads, and generated
ids could collide with ids retained by locked sections.

Four further tests assert **id uniqueness** — no duplicate layer or gradient-stop
ids after a remix, after chained remixes, and after every single-lock combination
remixed twice (the risky case: a locked section carries its old ids forward while
fresh ones are minted beside them). Determinism itself is checked on id-normalized
output, so it is blind to duplicates, and a duplicate is exactly what made two
layers on one pattern share a set of colors earlier in this project. Layer ids also
become element ids in the exported SVG, so uniqueness is a real requirement rather
than bookkeeping. Sabotaging `nextId()` to return a constant fails all three
duplicate checks.

Correction to an earlier note here: gradient-stop ids are React keys only, but
*layer* ids are not — they are interpolated into exported SVG element ids.

**Verified by sabotage**, one contract at a time: a lock-conditional RNG draw in
`remix()` → 1 failure; removing `mask` from `SKIP_TAGS` in `parse.ts` → 2 failures;
an off-by-one CRC in `zip.ts` → 2 failures. All restored, all 26 green after.

Two things beyond the brief, both flagged: **CI now runs `npm test` before the
build**, because a suite that only runs locally protects nobody and a regression
would otherwise deploy. And two README claims that had gone stale were corrected —
the control is "Composition style" now, and id namespacing is per rendered instance
rather than per pattern.

### Fixed: Remix flattened a user-arranged layer stack, even with sections locked

`remix()` rebuilt `doc.layers` in a canonical order every time —
`[accents-if-below] + patterns + shading + [accents-if-above]`. The section locks
preserved layer *contents* (`prevPatterns` / `prevShading` / `prevAccents` passed
through untouched) but the rebuild discarded their *positions*. So an arrangement
someone had made deliberately — shading between two patterns, an accent mid-stack,
shading below everything — was flattened by every Remix even with those sections
locked.

The earlier `accentsWereBelow` special case only preserved a binary
above/below-the-patterns position, not the actual slot, so it papered over one case
of a general bug.

**The rule now implemented: a locked section's layers keep their exact positions.**
Positions may only change for unlocked sections. The rebuild is replaced with
in-place substitution:

- remixed shading / accents go back into the slots they already occupied (and only
  the *first* of each is remixed, so duplicates pass through untouched instead of
  being dropped by `find()`);
- remixed pattern layers fill the existing pattern slots in order;
- a longer pattern run puts the surplus straight after the last existing pattern
  slot, else below the shading layer, else at the end; a shorter one drops the
  trailing slots;
- the accent above/below roll is still **drawn unconditionally** — the RNG
  invariant is about how many draws happen, not where results land — but it may
  only *move* the accent when accents are unlocked, and it moves that one layer to
  the bottom or top without disturbing anything else;
- shading is no longer force-seated after the patterns. If a document has shading
  below a pattern that was a choice; remixing its contents is fine, moving it is
  not.

Verified with a temporary harness (42 assertions, since deleted) on a deliberately
non-canonical fixture (`pattern > accent > pattern > shading`): with
patterns+shading+accents locked, `layers` is deep-equal *including order* across
seeds; with only patterns locked the pattern run keeps contents and relative order;
a locked mid-stack accent never lands on an edge; an unlocked accent still lands at
bottom or top and both occur across seeds; shading placed at index 0 stays there;
`remixSection` never reorders the sections it is not randomizing; pattern counts
still vary 1–3 with exactly one shading and one accent surviving; and the earlier
RNG invariant still holds. **Sabotaged** by reinstating the canonical rebuild — 24
assertions failed, so the checks bite.

The doc-level assertions stand in for the suggested click-through in the dev server,
which needs interaction this environment cannot drive; they cover more seeds than
hitting Remix by hand would.

### Changed: "Planet style" → "Composition style", and it now respects locks

Two related problems with the same control.

**It ignored the locks.** Each style rewrites planet mode *and* pattern / shading /
accent visibility — that is the intended design, the reference looks are
combinations rather than single settings. But it rewrote them unconditionally, so
applying a style over a locked section overwrote it. That contradicts "a lock is
absolute", which had been written down as a product rule and enforced everywhere in
`remix.ts` — the rule just had a hole where macros were concerned.

`applyPlanetStyle` now gates per section: `locks.planet` skips the mode rewrite,
`locks.patterns` skips the pattern-layer changes, `locks.shading` skips the shading
rewrite, `locks.accents` skips accents. Everything unlocked still applies. It
returns `{ doc, skipped }` so the toast can say what it left alone — "Composition
style: Flat disc (accents locked — left as is)". Still one `update()` call, so still
one undo entry.

Restructured into a `StylePlan` per style plus one lock-gated application, rather
than five copies of the gating. That also **fixed two latent bugs** in the old
rebuild, which threw the layer array away and reassembled it as
`[patterns, shading, accents]`:

- an accent layer deliberately placed *below* the patterns got silently restacked
  to the top;
- `find()` meant a *duplicated* shading or accent layer (the Duplicate button makes
  these) was dropped entirely.

Mapping layers in place preserves order and duplicates.

**It was misnamed.** Sitting in the Planet section and labelled "Planet style", it
read as planet-scoped while reaching across the whole composition. Renamed to
**Composition style**, with helper text: "Rewrites planet mode, shading, and layer
visibility together. Locked sections are left alone." Left in the Planet section —
that is where people look for it, and moving it would churn the UI for no gain.
`detectPlanetStyle` is unchanged.

### Clarified: what a section lock actually freezes

"Remix All with Planet locked changes the planet" is a reasonable reading of what
you see, and the geometry is in fact untouched — asserted, not assumed. Two other
things move:

- **Remix All re-rolls the palette** unless Colors is locked, and every planet color
  is a palette-slot reference, so a locked planet recolors head to toe. Working as
  designed; slot indirection is the point of the color system.
- **The style dropdown label** comes from `detectPlanetStyle`, which reads pattern
  and shading visibility — so remixing those flips the label even with the planet
  locked.

No behavior change. The lock chip's tooltip now states the split where the lock
lives: locked freezes settings and geometry, colors still follow the palette, use
the Palette lock for those. The Palette lock gets its own wording. CLAUDE.md records
the semantics, why capturing literal hexes would be the wrong fix, and that
`applyPlanetStyle` now honours locks.

### Published to GitHub Pages

Live at https://finalfinalff.github.io/planet-generator/, deployed by
`.github/workflows/deploy.yml` on every push to `main` using the official Pages
actions (`configure-pages` → `upload-pages-artifact` → `deploy-pages`).

**`base` is the literal `'/planet-generator/'`, not an env var.** A project page
serves from a sub-path, so assets cannot be root-relative. An env-var base would
have left `npm run dev` and `npm run preview` on `/`, which means local runs would
never exercise the thing most likely to break — a wrong base shows up as a blank
unstyled page, and the lazily-loaded `import.meta.glob` pattern chunks 404. Dev
matching prod is already the rule here, so the literal wins. Vite redirects `/` →
the base on both servers, so the CLAUDE.md QA recipe still works unchanged.

Verified before pushing: built, checked the emitted `index.html` referenced
`/planet-generator/assets/…`, served it with `npm run preview`, and screenshotted
the base URL — the app boots fully styled with patterns applied, which is only true
if the lazy chunks resolved. No 404s in the preview log.

The deploy is **type-checked**: `npm run build` is `tsc -b && vite build`, so a type
error fails the workflow instead of publishing a broken page.

Nothing else needed changing. The app has no `fetch`, no `public/` directory and no
root-relative URLs; patterns are bundled via `import.meta.glob` and state is
`localStorage`. The only absolute URLs are the Google Fonts links, which a base path
does not affect.

`Examples/`, `Palettes/` and `Frame 468.png` were untracked before publishing —
third-party posters and brand boards that a public repo would republish, and none
of them are needed to build. They stay on disk. `Patterns/` had to remain tracked
because the build globs it, and its art ships inside the JS bundle regardless of
repo visibility.

### Corrected: the pattern library has 18 files, not 17

Earlier entries and both docs asserted "17 files (the brief said 18)". That was
wrong — a miscount on first inspection, stated confidently and then propagated into
README, CLAUDE.md and this file, complete with an aside that the brief was
mistaken. `Patterns/` has always held 18 SVGs, all 18 tracked and all 18 parsing.
Corrected everywhere. The brief was right.

### Fixed: batch PNG filenames omitted the long-edge suffix

`exportBatch` named PNGs `planet-{seed}.png` while the single-file export uses
`planet-{seed}-{longEdge}.png`. Zipping the same batch at two sizes produced files
that could not be told apart. The batch path now appends `batchPngSize` the same
way — `planet-batch-abc123-1-1024.png`. SVG names are unchanged; there is no size
to record.

### Hardened: pattern SVGs are sanitized before insertion

Pattern markup reaches the DOM through `dangerouslySetInnerHTML`. `innerHTML` will
not execute a `<script>`, but that is not the whole surface: `on*` handlers on
inserted nodes do fire, and a `<foreignObject>` subtree is live HTML once
inserted. Drag-and-drop import means arbitrary files take that path.

`parsePatternSvg` now strips, before anything else: `<script>` and
`<foreignObject>` elements, every attribute whose name begins with `on`, and
`href` / `xlink:href` values that are not same-document fragments (so external and
`javascript:` targets go, while `url(#…)`-style references stay).

Applied to built-ins and imports through **one code path**. A "trusted" branch for
the shipped library would only drift, and running everything through it also keeps
junk out of exports. It runs before the color walk, so it also covers the
`<mask>` / `<clipPath>` subtrees that walk deliberately skips.

Verified with a temporary QA route (since deleted) against a deliberately hostile
SVG — inline `<script>`, `onload` on the root, `onclick`/`onmouseover`, an
uppercase `ONERROR`, a `<foreignObject>` containing `<img onerror>`, an external
`href`, a `javascript:` `xlink:href`, and a legitimate `#fragment` reference. All
the hostile parts are gone, the fragment reference and the geometry survive, and
mounting the sanitized template the way `PlanetSvg` does executes nothing. Also
re-parsed the whole built-in library to confirm nothing legitimate was lost: all 18
patterns still parse, all still yield color groups, 79 source colors total.

### Fixed: fully transparent color literals parsed to opaque black

`normalizeHex('transparent')` looked the keyword up in the named-color table,
getting `#00000000`, then hit the 8-digit branch which strips alpha — yielding
`#000000`. Alpha is tracked separately from the hex, so stripping it inverted the
meaning: in pattern parsing, invisible source geometry became a paintable black
ink group that showed up as soon as the pattern was recolored.

`normalizeHex` now returns **null** for fully transparent literals — the keyword,
`#rrggbb00`, and `#rgb0` — so they are treated as "not a color" and left untouched,
exactly like `none`. Because the named table maps `transparent` to `#00000000`, the
8-digit zero-alpha check covers the keyword too.

All call sites were already null-safe, checked rather than assumed: `parse.ts`
skips (`if (!hex) continue`) — that is the fix; `parseHexList` filters nulls;
`resolveColor` and the palette swatch input fall back to `#000000` as before, so
typing `transparent` into a hex override behaves the same as it always did. The
`'transparent'` strings in `registry.ts` are recolor *output* for an alpha-0 group,
not parsing, and are unaffected.

`rgba(…, 0)` still normalizes to its opaque RGB — the rgb branch never read alpha,
and that was left alone as out of scope.

Verified with a temporary QA route (since deleted): a table of literals through
`normalizeHex`, `isColorLiteral` and `parseHexList`, plus a synthetic pattern with
`fill="transparent"`, `fill="#11223300"`, `fill="none"` and a `style="fill:transparent"`
— asserting only white and black become color groups and the transparent fills
survive verbatim in the template.

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
are deliberately not globbed. There are **18** files.

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
