/**
 * Pattern source registry.
 *
 * `Patterns/` at the repo root is the source of truth — the duplicate SVGs
 * sitting next to it in the root folder are deliberately not globbed.
 * Sources are loaded lazily so the initial bundle stays small (the folder is
 * ~1.1 MB of raw SVG).
 */

const modules = import.meta.glob('../../../Patterns/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export type PatternSource = {
  id: string
  /** Display name, e.g. "Geometry Grid Patterns 4". */
  name: string
  load: () => Promise<string>
}

function toId(path: string): string {
  const file = path.split('/').pop() ?? path
  return file
    .replace(/\.svg$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function toName(path: string): string {
  const file = (path.split('/').pop() ?? path).replace(/\.svg$/i, '')
  return file.replace(/^SVG\s*-\s*/i, '').replace(/\s+/g, ' ').trim()
}

/**
 * Registered after this module evaluates (see `registerProceduralSources`),
 * because the procedural module imports the `PatternSource` type from here and
 * a value-level import in the other direction would be a cycle.
 */
export const PATTERN_SOURCES: PatternSource[] = Object.entries(modules)
  .map(([path, load]) => ({ id: toId(path), name: toName(path), load }))
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

/** Append generated sources (the procedural textures). Idempotent by id. */
export function registerSources(sources: PatternSource[]): void {
  for (const s of sources) {
    if (!PATTERN_SOURCES.some((p) => p.id === s.id)) PATTERN_SOURCES.push(s)
  }
}

export const PATTERN_IDS: string[] = PATTERN_SOURCES.map((p) => p.id)

export function getSource(id: string): PatternSource | undefined {
  return PATTERN_SOURCES.find((p) => p.id === id)
}
