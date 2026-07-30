/**
 * Remix determinism and lock absoluteness.
 *
 * These two contracts are invisible to visual inspection and have each already
 * regressed once — see CHANGELOG. Keep this file focused on them; it is not the
 * start of a general test suite.
 */

import { describe, expect, it } from 'vitest'
import { remix, remixSection, shuffleColors } from './remix'
import { defaultDoc } from './defaults'
import { BUILTIN_PALETTES, paletteById } from './palettes'
import type { ParsedPattern } from './patterns/parse'
import type { AccentLayer, Locks, PatternLayer, PlanetDoc, ShadingLayer } from '../types'

/**
 * Layer and gradient-stop ids come from `nextId()`, which is a Date.now() +
 * counter, not the RNG. They are React keys and nothing reads them, so
 * determinism is asserted on id-normalized output rather than raw JSON.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        k === 'id' ? '<id>' : normalize(v),
      ]),
    )
  }
  return value
}
const json = (value: unknown) => JSON.stringify(normalize(value))

/** Two tiny hand-built patterns — deliberately not read from `Patterns/`. */
function fakePattern(id: string): ParsedPattern {
  return {
    id,
    name: id,
    width: 100,
    height: 100,
    template:
      '<rect width="100" height="100" fill="%%c0%%"/>' +
      '<circle cx="50" cy="50" r="20" fill="%%c1%%" clip-path="url(#%%ns%%-c)"/>',
    tokenColors: ['#ffffff', '#000000'],
    tokenL: [1, 0],
    groups: [
      { index: 0, label: 'Plate', sample: '#ffffff', isBackground: true, tokens: [0], meanL: 1, weight: 1 },
      { index: 1, label: 'Ink 1', sample: '#000000', isBackground: false, tokens: [1], meanL: 0, weight: 1 },
    ],
    tokenGroup: [0, 1],
  }
}

const NO_LOCKS: Locks = {
  colors: false,
  background: false,
  planet: false,
  patterns: false,
  shading: false,
  accents: false,
}

const available = [fakePattern('fake-a'), fakePattern('fake-b')]
const palette = paletteById(BUILTIN_PALETTES, BUILTIN_PALETTES[0].id)
const deps = { available, palette }

const FIXTURE: PlanetDoc = { ...defaultDoc('fixture-seed'), locks: { ...NO_LOCKS } }
const withLocks = (patch: Partial<Locks>): PlanetDoc => ({
  ...FIXTURE,
  locks: { ...NO_LOCKS, ...patch },
})

const patterns = (d: PlanetDoc) => d.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
const shading = (d: PlanetDoc) => d.layers.find((l): l is ShadingLayer => l.kind === 'shading')
const accents = (d: PlanetDoc) => d.layers.find((l): l is AccentLayer => l.kind === 'accent')

describe('remix determinism', () => {
  it('is reproducible for the same seed, palette and locks', () => {
    const a = remix(FIXTURE, 'seed-1', deps)
    const b = remix(FIXTURE, 'seed-1', deps)
    expect(json(a)).toBe(json(b))
  })

  it('produces different output for a different seed', () => {
    expect(json(remix(FIXTURE, 'seed-1', deps))).not.toBe(json(remix(FIXTURE, 'seed-2', deps)))
  })

  /*
   * The draws-always invariant: a locked section still consumes its RNG draws,
   * so toggling one lock must not shift what any other section produces.
   */
  it('leaves unlocked sections untouched when an unrelated lock is toggled', () => {
    const base = remix(FIXTURE, 'seed-1', deps)
    const bgLocked = remix(withLocks({ background: true }), 'seed-1', deps)
    const shadingLocked = remix(withLocks({ shading: true }), 'seed-1', deps)

    // background locked -> everything else identical
    expect(json(bgLocked.planet)).toBe(json(base.planet))
    expect(json(patterns(bgLocked))).toBe(json(patterns(base)))
    expect(json(shading(bgLocked))).toBe(json(shading(base)))
    expect(json(accents(bgLocked))).toBe(json(accents(base)))

    // shading locked -> everything else identical
    expect(json(shadingLocked.background)).toBe(json(base.background))
    expect(json(shadingLocked.planet)).toBe(json(base.planet))
    expect(json(patterns(shadingLocked))).toBe(json(patterns(base)))
    expect(json(accents(shadingLocked))).toBe(json(accents(base)))
  })
})

describe('a lock is absolute', () => {
  it('remix never writes to a locked section', () => {
    for (const seed of ['s1', 's2', 's3', 's4']) {
      expect(json(remix(withLocks({ background: true }), seed, deps).background)).toBe(
        json(FIXTURE.background),
      )
      expect(json(remix(withLocks({ planet: true }), seed, deps).planet)).toBe(
        json(FIXTURE.planet),
      )
      expect(json(patterns(remix(withLocks({ patterns: true }), seed, deps)))).toBe(
        json(patterns(FIXTURE)),
      )
      expect(json(shading(remix(withLocks({ shading: true }), seed, deps)))).toBe(
        json(shading(FIXTURE)),
      )
      expect(json(accents(remix(withLocks({ accents: true }), seed, deps)))).toBe(
        json(accents(FIXTURE)),
      )
    }
  })

  it('remixSection on another section leaves the locked one alone', () => {
    const doc = withLocks({ planet: true })
    for (const section of ['background', 'patterns', 'shading', 'accents'] as const) {
      const out = remixSection(doc, section, `sec-${section}`, deps)
      expect(json(out.planet)).toBe(json(doc.planet))
    }
  })

  it('remixSection is a no-op on its own locked section', () => {
    const doc = withLocks({ accents: true })
    expect(remixSection(doc, 'accents', 'whatever', deps)).toBe(doc)
  })

  it('shuffleColors is a no-op when colors are locked', () => {
    const doc = withLocks({ colors: true })
    expect(json(shuffleColors(doc, palette, 'shuffle-seed'))).toBe(json(doc))
  })

  it('shuffleColors changes colors but no geometry when colors are unlocked', () => {
    const out = shuffleColors(FIXTURE, palette, 'shuffle-seed')
    const geometry = (d: PlanetDoc) =>
      json({
        planet: { ...d.planet, gradient: { ...d.planet.gradient, stops: null }, stroke: null },
        canvas: d.canvas,
        patternGeometry: patterns(d).map((p) => [p.scale, p.rotation, p.offsetX, p.offsetY, p.fit]),
      })
    expect(geometry(out)).toBe(geometry(FIXTURE))
    expect(json(out)).not.toBe(json(FIXTURE))
  })
})

describe('locked sections keep their stack position, not just their contents', () => {
  // A deliberately non-canonical stack: accent mid-stack, shading last.
  const arranged: PlanetDoc = (() => {
    const ps = patterns(FIXTURE)
    return {
      ...FIXTURE,
      layers: [ps[0], accents(FIXTURE)!, ps[1], shading(FIXTURE)!],
    }
  })()

  it('keeps layers deep-equal including order when all layer sections are locked', () => {
    const doc = { ...arranged, locks: { ...NO_LOCKS, patterns: true, shading: true, accents: true } }
    for (const seed of ['o1', 'o2', 'o3', 'o4']) {
      expect(json(remix(doc, seed, deps).layers)).toBe(json(doc.layers))
    }
  })

  it('keeps a locked accent off the edges of the stack', () => {
    const doc = { ...arranged, locks: { ...NO_LOCKS, accents: true } }
    for (const seed of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      const out = remix(doc, seed, deps)
      const at = out.layers.findIndex((l) => l.kind === 'accent')
      expect(at).toBeGreaterThan(0)
      expect(at).toBeLessThan(out.layers.length - 1)
    }
  })

  it('still moves an unlocked accent to the bottom or top', () => {
    const doc = { ...arranged, locks: { ...NO_LOCKS, patterns: true, shading: true } }
    const seen = new Set<string>()
    for (const seed of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10']) {
      const out = remix(doc, seed, deps)
      const at = out.layers.findIndex((l) => l.kind === 'accent')
      seen.add(at === 0 ? 'bottom' : at === out.layers.length - 1 ? 'top' : `mid:${at}`)
    }
    expect([...seen].sort()).toEqual(['bottom', 'top'])
  })

  it('does not re-seat shading that sits below the patterns', () => {
    const ps = patterns(FIXTURE)
    const doc: PlanetDoc = {
      ...FIXTURE,
      layers: [shading(FIXTURE)!, ps[0], accents(FIXTURE)!, ps[1]],
      locks: { ...NO_LOCKS, shading: true, patterns: true, accents: true },
    }
    for (const seed of ['sh1', 'sh2', 'sh3']) {
      expect(remix(doc, seed, deps).layers[0].kind).toBe('shading')
    }
  })
})
