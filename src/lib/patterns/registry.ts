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

/** Runtime-registered pattern (drag-and-dropped by the user, or synthetic). */
export function registerParsed(parsed: ParsedPattern): void {
  cache.set(parsed.id, parsed)
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

const TOKEN_RE = /%%c(\d+)%%/g

/** Apply resolved token colors to the template. */
export function recolor(parsed: ParsedPattern, resolved: string[]): string {
  return parsed.template.replace(TOKEN_RE, (_m, n: string) => resolved[Number(n)] ?? 'transparent')
}
