#!/usr/bin/env node
/**
 * orbgen MCP server (stdio). Tools to generate orbs with the app's own
 * renderer and to place them in Figma through the companion plugin.
 *
 * On start it claims the orbgen port (default 7331) so the Figma plugin can
 * connect; if another orbgen already holds it, this process forwards to that
 * one instead. stdout is the MCP channel — log to stderr only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { DEFAULT_PORT, VERSION, startOrConnect } from './service.mjs'

const service = await startOrConnect(DEFAULT_PORT)
console.error(
  service.remote
    ? `orbgen-mcp: using the orbgen already on port ${DEFAULT_PORT}`
    : `orbgen-mcp: serving the orbgen API + Figma bridge on http://127.0.0.1:${DEFAULT_PORT}`,
)

/** Shared "what to generate" parameters. */
const genShape = {
  count: z.number().int().min(1).max(50).optional().describe('How many orbs (1–50). Default 1.'),
  seed: z
    .string()
    .optional()
    .describe('Run seed for reproducibility; orb i gets `<seed>-<i>`. Default random.'),
  base: z
    .string()
    .optional()
    .describe(
      "Starting design: 'default' (the shipped RSAC Collage Spectrum preset), 'blank', or a preset name/id. Default 'default'.",
    ),
  palette: z.string().optional().describe('Palette name or id for every orb (see orbgen_options).'),
  vary_palette: z.boolean().optional().describe('Each orb picks its own palette from its seed.'),
  orb_type: z
    .enum(['color', 'pattern', 'segments'])
    .optional()
    .describe('Pin the orb type. Default: whatever the base/remix deals.'),
  color_source: z
    .enum(['palette', 'gradients'])
    .optional()
    .describe("'gradients' uses the named RSAC brand gradients at every gradient site."),
  flat: z.boolean().optional().describe('Suppress shading and rim light (no 3D cues).'),
  solid_fills: z.boolean().optional().describe('Render every smooth gradient as a flat ink.'),
  photos: z
    .array(
      z.object({
        path: z.string().optional().describe('Local image path (JPEG/PNG/WebP) or http(s) URL.'),
        library_id: z.string().optional().describe('A photo library id from list_library_photos (lib:…).'),
        zoom: z.number().min(1).max(8).optional().describe('1 = cover the cell. Default 1.'),
        focus_x: z.number().min(0).max(1).optional().describe('Focal point X kept in view (0 left – 1 right). Library photos default to their detected faces.'),
        focus_y: z.number().min(0).max(1).optional().describe('Focal point Y (0 top – 1 bottom).'),
      }),
    )
    .optional()
    .describe(
      'The photo pool. Each orb gets photos_per_orb_min–max DIFFERENT pool photos in different segments, each with its own framing. Forces the segments type unless orb_type pins another.',
    ),
  photo_path: z.string().optional().describe('Shorthand for a one-photo pool: a local image path or URL.'),
  library_tags: z
    .array(z.string())
    .optional()
    .describe('Fill the pool from the RSAC photo library: folder tags to draw from (see orbgen_options), e.g. "Tuesday Selects".'),
  library_search: z.string().optional().describe('Fill the pool from library photos whose name or folder contains this.'),
  library_selects_only: z.boolean().optional().describe('Library picks only from curated selects folders. Default true.'),
  library_favorites_only: z
    .boolean()
    .optional()
    .describe('Library picks only from the favorites starred in the editor’s photo library.'),
  library_count: z.number().int().min(1).max(200).optional().describe('How many library photos to put in the pool (seeded). Default 12.'),
  photos_per_orb_min: z.number().int().min(0).max(6).optional().describe('Fewest pool photos per orb. Default 1.'),
  photos_per_orb_max: z.number().int().min(0).max(6).optional().describe('Most pool photos per orb. Default = min (or 1).'),
  include_patterns: z.array(z.string()).optional().describe('Only deal these patterns (names or ids).'),
  exclude_patterns: z.array(z.string()).optional().describe('Never deal these patterns.'),
  transparent: z.boolean().optional().describe('Drop the background.'),
  canvas_width: z.number().int().min(16).max(8000).optional(),
  canvas_height: z.number().int().min(16).max(8000).optional(),
}

function toBody(a) {
  const body = {
    count: a.count,
    seed: a.seed,
    base: a.base,
    palette: a.palette,
    varyPalette: a.vary_palette,
    orbType: a.orb_type,
    colorSource: a.color_source,
    flat: a.flat,
    solidFills: a.solid_fills,
    transparent: a.transparent,
  }
  const photos = (a.photos ?? []).map((p) => ({
    ...(p.library_id ? { id: p.library_id } : /^https?:\/\//.test(p.path ?? '') ? { url: p.path } : { path: p.path }),
    zoom: p.zoom,
    focusX: p.focus_x,
    focusY: p.focus_y,
  }))
  if (a.photo_path) photos.push(/^https?:\/\//.test(a.photo_path) ? { url: a.photo_path } : { path: a.photo_path })
  if (photos.length) body.photos = photos
  if (
    a.library_tags ||
    a.library_search ||
    a.library_count ||
    a.library_selects_only !== undefined ||
    a.library_favorites_only
  ) {
    body.library = {
      tags: a.library_tags,
      search: a.library_search,
      selectsOnly: a.library_selects_only,
      favoritesOnly: a.library_favorites_only,
      count: a.library_count,
    }
  }
  if (a.photos_per_orb_min !== undefined || a.photos_per_orb_max !== undefined) {
    body.photosPerOrb = { min: a.photos_per_orb_min, max: a.photos_per_orb_max }
  }
  if (a.include_patterns || a.exclude_patterns) {
    body.patterns = { include: a.include_patterns, exclude: a.exclude_patterns }
  }
  if (a.canvas_width || a.canvas_height) {
    body.canvas = { width: a.canvas_width ?? a.canvas_height, height: a.canvas_height ?? a.canvas_width }
  }
  return body
}

const text = (t) => ({ content: [{ type: 'text', text: t }] })
const fail = (err) => ({ ...text(`Error: ${err instanceof Error ? err.message : String(err)}`), isError: true })

const server = new McpServer({ name: 'orbgen', version: VERSION })

server.registerTool(
  'orbgen_options',
  {
    title: 'List orb options',
    description:
      'List the palettes, presets, patterns and orb types the Orb generator can use. Call this to find valid names for generate_orbs / place_orbs_in_figma.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const o = await service.options()
      return text(
        [
          `Orb types: ${o.orbTypes.join(', ')}`,
          `Presets: ${o.presets.map((p) => `${p.name}${p.default ? ' (default)' : ''}`).join(', ')}`,
          `Palettes (${o.palettes.length}): ${o.palettes.map((p) => p.name).join(', ')}`,
          `Patterns (${o.patterns.length}): ${o.patterns.map((p) => p.name).join(', ')}`,
          o.library?.photos
            ? `Photo library: ${o.library.photos} photos (${o.library.selects} selects). Folder tags: ${o.library.tags.map((t) => `${t.name} (${t.count})`).join(', ')}`
            : 'Photo library: none built (tools/photo-library).',
        ].join('\n'),
      )
    } catch (err) {
      return fail(err)
    }
  },
)

server.registerTool(
  'generate_orbs',
  {
    title: 'Generate orbs',
    description:
      "Generate orb artwork with the Orb generator's own renderer (identical to exporting from the app) and write SVG/PNG files. Each orb is a remix of the base design from its own seed — like the app's Batch. Returns file paths and seeds, not the markup.",
    inputSchema: {
      ...genShape,
      format: z.enum(['svg', 'png', 'both']).optional().describe('Default svg.'),
      png_size: z.number().int().min(64).max(8192).optional().describe('PNG long edge in px. Default 2048.'),
      output_dir: z.string().optional().describe('Where to write files. Default ~/Downloads/orbgen/<seed>.'),
      include_doc: z.boolean().optional().describe('Also write each orb’s document JSON (reloadable in the app).'),
    },
  },
  async (a) => {
    try {
      const r = await service.generate({
        ...toBody(a),
        format: a.format,
        pngSize: a.png_size,
        outputDir: a.output_dir,
        includeDoc: a.include_doc,
      })
      const lines = r.orbs.map(
        (o) => `- ${o.name} · ${o.orbType} · ${o.paletteName}: ${Object.values(o.files).join(', ')}`,
      )
      return text(
        [`Generated ${r.orbs.length} orb(s), run seed "${r.seed}", in ${r.outputDir}`, ...lines, ...r.notes.map((n) => `Note: ${n}`)].join('\n'),
      )
    } catch (err) {
      return fail(err)
    }
  },
)

server.registerTool(
  'place_orbs_in_figma',
  {
    title: 'Generate orbs and place them in Figma',
    description:
      'Generate orbs and place them on the current Figma page, in a new frame laid out as a grid at the viewport center. Needs the "Orb Generator Bridge" development plugin running in Figma desktop (check with figma_bridge_status). SVG placement gives editable, named layers; PNG gives image fills.',
    inputSchema: {
      ...genShape,
      as: z.enum(['svg', 'png']).optional().describe('svg (editable vectors, default) or png (image fills).'),
      frame_name: z.string().optional().describe('Name of the frame created in Figma. Default "Orbs <seed>".'),
      columns: z.number().int().min(1).max(20).optional().describe('Grid columns. Default ≈ √count.'),
      size: z.number().min(16).max(4000).optional().describe('Each orb’s size in Figma, px. Default 400.'),
      gap: z.number().min(0).max(1000).optional().describe('Gap between orbs, px. Default 40.'),
    },
  },
  async (a) => {
    try {
      const r = await service.placeInFigma({
        ...toBody(a),
        as: a.as,
        layout: { name: a.frame_name, columns: a.columns, size: a.size, gap: a.gap },
      })
      return text(
        [
          `Placed ${r.placed?.placed ?? r.orbs.length} orb(s) in Figma on page "${r.placed?.page ?? '?'}" as frame "${r.placed?.frameName ?? ''}" (node ${r.placed?.frameId ?? '?'}).`,
          `Run seed "${r.seed}": ${r.orbs.map((o) => o.seed).join(', ')}`,
          ...r.notes.map((n) => `Note: ${n}`),
        ].join('\n'),
      )
    } catch (err) {
      return fail(err)
    }
  },
)

server.registerTool(
  'list_library_photos',
  {
    title: 'Search the photo library',
    description:
      'Search the local RSAC conference photo library by name/folder text, folder tags, selects or favorites (favorites and hidden photos are curated in the editor’s Photos page). Returns library ids (for the `photos` parameter), folder tags, face counts, site-wide focal points and thumbnail paths you can view.',
    inputSchema: {
      search: z.string().optional().describe('Text in the photo name or a folder tag, e.g. "keynote".'),
      tags: z.array(z.string()).optional().describe('Exact folder tags (any match).'),
      selects_only: z.boolean().optional().describe('Only curated selects. Default false.'),
      favorites_only: z.boolean().optional().describe('Only favorites starred in the editor’s photo library.'),
      limit: z.number().int().min(1).max(500).optional().describe('Default 50.'),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    try {
      const r = await service.libraryPhotos({
        search: a.search,
        tags: a.tags,
        selectsOnly: a.selects_only,
        favoritesOnly: a.favorites_only,
        limit: a.limit,
      })
      if (!r.total) return text(r.note ?? 'No photos matched.')
      return text(
        [
          `${r.total} photo(s) matched${r.total > r.photos.length ? `; showing ${r.photos.length}` : ''} (${r.favorites} favorites in the library; hidden photos excluded):`,
          ...r.photos.map(
            (p) =>
              `- ${p.favorite ? '★ ' : ''}${p.id} · ${p.tags.slice(1).join(' / ')} · ${p.faces} face(s) · focus ${p.focusX},${p.focusY} · thumb ${p.thumb}`,
          ),
        ].join('\n'),
      )
    } catch (err) {
      return fail(err)
    }
  },
)

server.registerTool(
  'figma_bridge_status',
  {
    title: 'Figma bridge status',
    description: 'Is the "Orb Generator Bridge" plugin connected in Figma? Placement needs it open.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const s = await service.figmaStatus()
      return text(
        s.connected
          ? `Connected (last seen ${Math.round(s.lastSeenMsAgo / 1000)}s ago). Queued: ${s.queued}, in flight: ${s.inflight}.`
          : 'Not connected. In Figma desktop run Plugins → Development → "Orb Generator Bridge" (import tools/orbgen/figma-plugin/manifest.json once) and leave its window open.',
      )
    } catch (err) {
      return fail(err)
    }
  },
)

await server.connect(new StdioServerTransport())

const shutdown = async () => {
  await service.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('close', shutdown)
