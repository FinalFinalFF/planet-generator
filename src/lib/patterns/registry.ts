/** Async load + parse cache for pattern sources, plus recoloring. */

import { clamp, labToHex, hexToLab, withAlpha } from '../color'
import { parsePatternSvg, type ParsedPattern } from './parse'
import { getSource, PATTERN_SOURCES } from './source'

const cache = new Map<string, ParsedPattern>()
const inflight = new Map<string, Promise<ParsedPattern>>()

export function getParsed(id: string): ParsedPattern | undefined {
  return cache.get(id)
}

export function loadPattern(id: string): Promise<ParsedPattern> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(id)
  if (pending) return pending
  const src = getSource(id)
  if (!src) return Promise.reject(new Error(`Unknown pattern: ${id}`))
  const p = src
    .load()
    .then((raw) => {
      const parsed = parsePatternSvg(src.id, src.name, raw)
      cache.set(id, parsed)
      inflight.delete(id)
      return parsed
    })
    .catch((err) => {
      inflight.delete(id)
      throw err
    })
  inflight.set(id, p)
  return p
}

/** Warm the cache for a set of ids; resolves once all are parsed. */
export function loadPatterns(ids: readonly string[]): Promise<ParsedPattern[]> {
  return Promise.all([...new Set(ids)].map(loadPattern))
}

/* ---------- runtime-imported patterns ---------- */

export type ImportedPattern = { id: string; name: string; raw: string }

/** Ids of patterns the user dropped in, newest last. */
const imported: ImportedPattern[] = []

function uniqueId(base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pattern'
  let id = `u-${slug}`
  let n = 2
  while (cache.has(id) || getSource(id)) id = `u-${slug}-${n++}`
  return id
}

/**
 * Parse and register a dropped SVG through the same pipeline as the built-ins,
 * so it gets identical fill extraction and palette-slot mapping.
 */
export function importPatternSvg(filename: string, raw: string): ParsedPattern {
  const name = filename.replace(/\.svg$/i, '').trim() || 'Imported pattern'
  const id = uniqueId(name)
  const parsed = parsePatternSvg(id, name, raw)
  cache.set(id, parsed)
  imported.push({ id, name, raw })
  return parsed
}

/** Re-register patterns restored from storage. Skips anything that fails. */
export function rehydrateImported(list: ImportedPattern[]): ParsedPattern[] {
  const out: ParsedPattern[] = []
  for (const item of list) {
    if (cache.has(item.id)) continue
    try {
      const parsed = parsePatternSvg(item.id, item.name, item.raw)
      cache.set(item.id, parsed)
      imported.push(item)
      out.push(parsed)
    } catch {
      // A pattern that no longer parses is dropped rather than breaking boot.
    }
  }
  return out
}

export function listImported(): ImportedPattern[] {
  return imported.slice()
}

export function removeImported(id: string): void {
  const i = imported.findIndex((p) => p.id === id)
  if (i >= 0) imported.splice(i, 1)
  cache.delete(id)
}

/**
 * Every pattern that can currently be chosen: the built-in library plus
 * anything imported this session. The UI reads this rather than
 * `PATTERN_SOURCES` so imports show up in the pickers and in Remix.
 */
export function listPatternOptions(): Array<{ id: string; name: string; imported: boolean }> {
  return [
    ...PATTERN_SOURCES.map((s) => ({ id: s.id, name: s.name, imported: false })),
    ...imported.map((p) => ({ id: p.id, name: p.name, imported: true })),
  ]
}

export { PATTERN_SOURCES }

/* ---------- recoloring ---------- */

export type GroupPaint = { hex: string; alpha: number }

/**
 * Resolve the final color for every token. Members of a group keep their
 * lightness offset from the group mean, so a gradient that was mapped onto one
 * palette slot still reads as a gradient.
 */
export function resolveTokens(parsed: ParsedPattern, paints: GroupPaint[]): string[] {
  const out = new Array<string>(parsed.tokenColors.length)
  for (const group of parsed.groups) {
    const paint = paints[group.index] ?? { hex: parsed.groups[group.index].sample, alpha: 1 }
    if (paint.alpha <= 0.001) {
      for (const t of group.tokens) out[t] = 'transparent'
      continue
    }
    const targetLab = hexToLab(paint.hex)
    const spread = group.tokens.length > 1
    for (const t of group.tokens) {
      let hex = paint.hex
      if (spread) {
        const delta = parsed.tokenL[t] - group.meanL
        if (Math.abs(delta) > 0.004) {
          hex = labToHex({ ...targetLab, L: clamp(targetLab.L + delta, 0, 1) })
        }
      }
      out[t] = withAlpha(hex, paint.alpha)
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = parsed.tokenColors[i]
  return out
}

/** Colors and the id namespace in one alternation, so recoloring stays one pass. */
const TOKEN_RE = /%%(?:c(\d+)|ns)%%/g

/**
 * Apply resolved token colors and the instance id namespace to the template.
 *
 * `namespace` must be unique per rendered instance — per layer *and* per host
 * `<svg>`. Internal ids are rewritten to `{namespace}-{id}`; two instances
 * sharing a namespace in one document would give the second the first's colors,
 * since `url(#…)` resolves document-wide to the first match.
 */
export function recolor(
  parsed: ParsedPattern,
  resolved: string[],
  namespace: string,
): string {
  // Keep the namespace to characters that are valid in an XML id.
  const ns = namespace.replace(/[^A-Za-z0-9_-]/g, '') || 'ns'
  return parsed.template.replace(TOKEN_RE, (_m, n: string | undefined) =>
    n === undefined ? ns : (resolved[Number(n)] ?? 'transparent'),
  )
}
