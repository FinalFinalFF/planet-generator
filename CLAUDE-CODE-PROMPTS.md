# Claude Code Prompts — Planet Graphic Generator

Run these from this folder (`Experiments/Planets`). Use Prompt 1 to build, then the follow-ups to layer in features. Run `/init` **after** Prompt 1 completes (it documents an existing codebase — it's not a build command).

---

## Prompt 1 — Core build

```
Build a web-based brand graphics generator that produces "planet" graphics: circular
compositions made of layered gradients and geometric patterns, clipped to a circle.

REFERENCE MATERIAL (in this folder):
- Examples/ — target aesthetic. "image 41.png" is a sphere built from overlapping
  translucent circle slices with a gradient sweep (red→yellow→teal) on black.
  "image 40.png" shows circles filled with gradients + pattern overlays (grids, dot
  halftones, topo lines, concentric circles) with soft blend overlaps. Study both.
- Patterns/ — 18 SVG pattern files used as inner fill textures for planets. These have
  hardcoded fills (e.g. fill="black", fill="white", fill="#278576"). At build time or
  load time, parse each SVG, extract its unique fill colors, and map each to a palette
  slot so patterns are fully recolorable from the active palette. Normalize viewBoxes
  and inline them as reusable <pattern>/<symbol> defs. Ignore duplicate SVGs sitting
  in the folder root; Patterns/ is the source of truth.

TECH STACK:
- Vite + React + TypeScript. Render the artwork as inline SVG (a single <svg> element
  is the source of truth) so SVG export is a direct serialization. No canvas rendering
  except for PNG rasterization at export time. No backend; runs entirely client-side.
  Persist state in localStorage.

PLANET MODEL (layered, all layers optional and reorderable):
1. Background — solid, gradient, or transparent; canvas can be square/16:9/custom px.
2. Planet base — circle with gradient fill (linear/radial/conic; editable stops, angle).
3. Pattern layer(s) — one or more patterns from Patterns/, clipped to the planet circle,
   each with: pattern choice, scale, rotation, x/y offset, opacity, blend mode
   (multiply/screen/overlay/soft-light/normal), and palette-slot color assignments.
4. Sphere shading — optional radial highlight + terminator shadow overlay to create
   the 3D sphere illusion (like image 41), with intensity + light-angle controls.
5. Accents — optional orbital ring arcs, crescent rim light, and satellite mini-circles.

COLOR SYSTEM:
- Palettes are named ordered lists of hex colors. Ship 5–6 good defaults inspired by
  the examples (e.g. red/amber/teal on near-black; brights on pale blue).
- I must be able to: paste a list of hex codes to create a palette, import/export
  palettes as JSON, save palettes to localStorage, and set the active palette.
- Every colored element references a palette slot index (not a raw hex), so switching
  palettes instantly recolors the whole composition. Allow per-element hex override.

REMIX / RANDOMIZE:
- A seeded RNG drives a "Remix" button: randomizes layer combo, pattern choices,
  gradient angles/stops, scales, offsets, blend modes — within the active palette.
- Show the seed; typing a seed reproduces the output. Add per-section "lock" toggles
  so I can freeze (e.g.) colors while remixing geometry.
- "Shuffle colors" alone: re-deal palette slots without changing geometry.

UI:
- Left: large centered live preview on a checkerboard/neutral stage, with zoom.
- Right: collapsible sidebar with sections (Canvas, Background, Planet, Pattern
  layers, Shading, Accents, Palette, Export). Sliders with numeric inputs for all
  continuous values. Layer list supports add/remove/duplicate/reorder.
- Header: Remix, seed field, undo/redo, and Save/Load named presets (localStorage).

EXPORT:
- SVG: serialize the live SVG with all defs inlined; self-contained file.
- PNG: rasterize at 1x/2x/4x and at explicit pixel sizes (1024, 2048, 4096).
- Transparent-background toggle for both. Sensible filenames (planet-{seed}.svg).

QUALITY BAR:
- The default first-load composition should look gallery-ready, not programmer-art.
- Verify: run the dev server, generate several remixes, and confirm exported SVG
  opens cleanly in a browser and matches the preview.
```

---

## Prompt 2 — After the core works: fidelity pass

```
Compare the app's output against Examples/image 41.png and Examples/image 40.png and
close the gap. Specifically: (1) add a "sliced sphere" planet mode that builds the
planet from overlapping translucent vertical circle slices with a hue sweep across
them, like image 41; (2) add soft pattern-in-circle overlap behavior with blend modes
like image 40; (3) tune default shading so planets read as spheres, not flat circles.
Add each as a preset I can pick from a "Planet style" dropdown.
```

## Prompt 3 — Batch + workflow polish

```
Add: (1) a batch mode that generates an N-up grid of remixes from the current settings
so I can cherry-pick and promote one to the editor; (2) "export all" for a batch as
individual SVG/PNG files in a zip; (3) drag-and-drop import of additional pattern SVGs
at runtime, run through the same fill-extraction/palette-mapping pipeline; (4) keyboard
shortcuts (R = remix, S = shuffle colors, E = export).
```

## Useful follow-up snippets

- "The pattern recoloring missed some elements — also remap `stroke` attributes and colors set via `style=""`."
- "PNG export is blurry — render at devicePixelRatio × requested scale."
- "Conic gradients don't serialize to plain SVG — approximate with a segmented mesh or drop conic from SVG export and warn."
