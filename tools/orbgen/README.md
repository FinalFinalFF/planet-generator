# orbgen — API, MCP server and Figma bridge

Generate orbs programmatically with the app's **own** renderer and exporter,
and place them in Figma. Output is byte-identical to exporting the same
document from the editor: generation runs the app's `api.html`
(`src/api.tsx`, `window.orbgen`) in headless Chrome rather than re-implementing
rendering in Node.

```
Claude / scripts ──MCP (stdio)──┐
                                ├─► orbgen service :7331 ──CDP──► headless Chrome ► api.html
curl / HTTP ─────REST───────────┘          │
                                           └─◄ long-poll ── Figma plugin "Orb Generator Bridge"
```

## Setup (once)

```bash
npm run build          # orbgen renders from dist/ (re-run after app changes)
npm run orbs:install   # installs the MCP SDK into tools/orbgen
```

Needs Google Chrome (or set `CHROME_PATH`).

**Claude Code:** the repo's `.mcp.json` registers the `orbgen` server, so
sessions started in this repo get the tools after approving it.

**Figma:** Figma desktop → Plugins → Development → *Import plugin from
manifest…* → `tools/orbgen/figma-plugin/manifest.json`. Then run *Orb
Generator Bridge* and leave its small window open; it shows "Connected" while
orbgen is running.

## MCP tools

| Tool | What it does |
|------|--------------|
| `orbgen_options` | Palettes, presets, patterns, orb types (valid names) |
| `generate_orbs` | Remix N orbs from a base design → SVG/PNG files (default `~/Downloads/orbgen/<seed>/`) |
| `place_orbs_in_figma` | Generate, then place them on the current Figma page as a named grid frame |
| `list_library_photos` | Search the local photo library (ids, tags, focal points, thumbnails) |
| `figma_bridge_status` | Is the Figma plugin connected? |

Shared options: `count`, `seed`, `base` (preset name, `default`, `blank`),
`palette`, `vary_palette`, `orb_type`, `color_source`, `flat`, `solid_fills`,
`photo_path` (+ `photo_zoom`, `photo_focus_x/y`), `include_patterns` /
`exclude_patterns`, `transparent`, `canvas_width/height`.

**Photos** work like the editor's photo pool: `photos` (local paths, URLs or
library ids, each with optional `zoom` / `focus_x` / `focus_y`) and/or
`library_tags` / `library_search` / `library_count` (picked from the run seed)
fill the pool, and every orb gets `photos_per_orb_min`–`max` *different*
photos in different segments. `list_library_photos` searches the local RSAC
photo library and returns ids, folder tags and thumbnail paths.

Favorites, hidden photos and site-wide focal points are curated in the
editor's **Photos** page and saved to `photo-library/prefs.json`, which orbgen
reads: `library_favorites_only` / `favorites_only` draw from favorites, hidden
photos are never picked, and a library photo's default framing is the one set
in the editor.

## REST API

`npm run orbs:server` (or any running MCP server) listens on
`http://127.0.0.1:7331`:

```bash
curl -s -X POST localhost:7331/v1/generate -H 'content-type: application/json' \
  -d '{"count": 9, "seed": "keynote", "palette": "RSAC Main", "photoPath": "~/Desktop/speaker.jpg",
       "photo": {"focusX": 0.5, "focusY": 0.3}, "format": "both"}'

curl -s -X POST localhost:7331/v1/figma/place -H 'content-type: application/json' \
  -d '{"count": 6, "layout": {"name": "Hero options", "columns": 3, "size": 400}}'
```

The body is `GenerateRequest` from `src/api.tsx`, plus `photoPath`/`photoUrl`,
`outputDir`, `write: false` (return markup inline instead of writing files),
and for placement `layout` and `as: "svg" | "png"`. `GET /v1/options`,
`GET /v1/figma/status`.

## Notes

- Seeds work like Batch: orb *i* of run `seed` is `seed-i`, reproducible from
  the seed and options (`orbgen-run.json` in each output folder records both).
- The photo library (`photo-library/`, see below) is served at
  `/photo-library/*` and searchable at `GET /v1/library?search=&tag=&selects=1`.
- Only the built-in patterns are available — patterns imported in a browser
  live in that browser's storage.
- One orbgen owns the port; a second MCP server forwards to it, so the plugin
  always has one address. `ORBGEN_PORT` changes the port (also update the
  plugin's `manifest.json` and `ui.html`).
- `ORBGEN_APP_URL=http://localhost:5173` renders from the dev server instead of
  `dist/`, so app edits show up without rebuilding.

## The photo library

`photo-library/` (untracked — client photos never go into this public repo)
holds resized copies of the RSAC conference photos: `full/` (≤2048 px, EXIF
orientation baked in, metadata stripped), `thumbs/` (≤320 px) and
`catalog.json` (size, folder tags, a "selects" flag, and a focal point from
macOS face detection). Build or extend it with:

```bash
npm run photos:build -- "<source folder>" ["<source folder>" …]
```

It is re-runnable: photos already built are kept, so adding a folder only
processes what is new. Duplicates (same file name and aspect within a source —
the selects folders re-export the high-res originals) merge into one photo
tagged with every folder it appeared in. The dev server and orbgen serve it;
the public site has none.
