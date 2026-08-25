/**
 * Remix determinism and lock absoluteness.
 *
 * These two contracts are invisible to visual inspection and have each already
 * regressed once — see CHANGELOG. Keep this file focused on them; it is not the
 * start of a general test suite.
 */

import { describe, expect, it } from 'vitest'
import { remix, remixSection, shuffleColors } from './remix'
import { applyOrbType, defaultDoc, normalizeDoc } from './defaults'
import { BUILTIN_PALETTES, paletteById } from './palettes'
import type { ParsedPattern } from './patterns/parse'
import type {
  AccentLayer,
  Locks,
  PatternLayer,
  OrbDoc,
  SectorFill,
  ShadingLayer,
  SubLocks,
} from '../types'

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
  orb: false,
  patterns: false,
  shading: false,
  accents: false,
}

const available = [fakePattern('fake-a'), fakePattern('fake-b')]
const palette = paletteById(BUILTIN_PALETTES, BUILTIN_PALETTES[0].id)
const deps = { available, palette }

const FIXTURE: OrbDoc = { ...defaultDoc('fixture-seed'), locks: { ...NO_LOCKS } }
const withLocks = (patch: Partial<Locks>): OrbDoc => ({
  ...FIXTURE,
  locks: { ...NO_LOCKS, ...patch },
})

const patterns = (d: OrbDoc) => d.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
const shading = (d: OrbDoc) => d.layers.find((l): l is ShadingLayer => l.kind === 'shading')
const accents = (d: OrbDoc) => d.layers.find((l): l is AccentLayer => l.kind === 'accent')

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
    expect(json(bgLocked.orb)).toBe(json(base.orb))
    expect(json(patterns(bgLocked))).toBe(json(patterns(base)))
    expect(json(shading(bgLocked))).toBe(json(shading(base)))
    expect(json(accents(bgLocked))).toBe(json(accents(base)))

    // shading locked -> everything else identical
    expect(json(shadingLocked.background)).toBe(json(base.background))
    expect(json(shadingLocked.orb)).toBe(json(base.orb))
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
      expect(json(remix(withLocks({ orb: true }), seed, deps).orb)).toBe(
        json(FIXTURE.orb),
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
    const doc = withLocks({ orb: true })
    for (const section of ['background', 'patterns', 'shading', 'accents'] as const) {
      const out = remixSection(doc, section, `sec-${section}`, deps)
      expect(json(out.orb)).toBe(json(doc.orb))
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
    const geometry = (d: OrbDoc) =>
      json({
        orb: {
          ...d.orb,
          gradient: { ...d.orb.gradient, stops: null },
          stroke: null,
          // Sector fills are colors, and shuffleColors re-deals them; the
          // structure they hang off is the geometry that must not move.
          sectors: {
            angle: d.orb.sectors.angle,
            offset: d.orb.sectors.offset,
            cells: [d.orb.sectors.rowA.length, d.orb.sectors.rowB.length],
          },
        },
        canvas: d.canvas,
        patternGeometry: patterns(d).map((p) => [p.scale, p.rotation, p.offsetX, p.offsetY, p.fit]),
      })
    expect(geometry(out)).toBe(geometry(FIXTURE))
    expect(json(out)).not.toBe(json(FIXTURE))
  })
})

/*
 * Determinism above is checked on id-normalized output, which means it cannot see
 * *duplicate* ids. That gap is worth closing explicitly: layer ids become element
 * ids in the exported SVG, and a collision is what caused two layers on the same
 * pattern to paint with one set of colors (see CHANGELOG). The risky case is a
 * repeat remix, where a locked section keeps its old ids while new ones are minted.
 */
describe('ids stay unique', () => {
  const duplicates = (values: string[]) => {
    const seen = new Set<string>()
    return [...new Set(values.filter((v) => seen.has(v) || (seen.add(v), false)))]
  }
  const allIds = (d: OrbDoc) => [
    ...d.layers.map((l) => l.id),
    ...d.background.gradient.stops.map((s) => s.id),
    ...d.orb.gradient.stops.map((s) => s.id),
  ]

  it('has no duplicate ids after a single remix', () => {
    for (const seed of ['i1', 'i2', 'i3', 'i4']) {
      expect(duplicates(allIds(remix(FIXTURE, seed, deps)))).toEqual([])
    }
  })

  it('has no duplicate ids after chained remixes', () => {
    let doc = FIXTURE
    for (const seed of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      doc = remix(doc, seed, deps)
      expect(duplicates(allIds(doc))).toEqual([])
    }
  })

  it('has no duplicate ids when a lock carries old ids into a new remix', () => {
    // Every combination of one lock, remixed twice: the locked section keeps its
    // ids from run one while run two mints fresh ones alongside them.
    for (const lock of ['background', 'orb', 'patterns', 'shading', 'accents'] as const) {
      const first = remix(withLocks({ [lock]: true }), 'lk1', deps)
      const second = remix({ ...first, locks: { ...NO_LOCKS, [lock]: true } }, 'lk2', deps)
      expect(duplicates(allIds(second))).toEqual([])
    }
  })

  it('gives every layer its own id, so export element ids cannot collide', () => {
    const out = remix(FIXTURE, 'unique-seed', deps)
    const layerIds = out.layers.map((l) => l.id)
    expect(new Set(layerIds).size).toBe(layerIds.length)
  })
})

/*
 * Flat mode is a standing constraint, not a lock and not a macro: it must survive
 * any remix, and it must suppress purely at render time. The second half is the
 * part worth testing here — if suppression ever became a data mutation, remix
 * would start erasing the shading and rim settings a user is expecting to get
 * back, and nothing on screen would say so while flat is on.
 */
describe('flat mode', () => {
  const flat: OrbDoc = { ...FIXTURE, flat: true }
  const SEEDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']

  it('survives remix and Remix All across many seeds', () => {
    for (const seed of SEEDS) expect(remix(flat, seed, deps).flat).toBe(true)
    // Chained, the way repeated Remix All presses compose.
    let doc = flat
    for (const seed of SEEDS) {
      doc = remix(doc, seed, deps)
      expect(doc.flat).toBe(true)
    }
  })

  it('is not turned on by a remix of a non-flat document', () => {
    for (const seed of SEEDS) expect(remix(FIXTURE, seed, deps).flat).toBe(false)
  })

  /*
   * The load-bearing one: flat changes *nothing* in the document but the flag, so
   * toggling it back off is enough to restore shading exactly. Asserted against a
   * non-flat remix of the same seed, which pins that no draw was skipped either —
   * a shading or rim draw removed under flat would shift every later section.
   */
  it('changes no layer data, so toggling it off restores shading exactly', () => {
    for (const seed of SEEDS) {
      const flatOut = remix(flat, seed, deps)
      const plainOut = remix(FIXTURE, seed, deps)
      expect(json({ ...flatOut, flat: false })).toBe(json(plainOut))
    }
  })

  it('keeps the shading layer and the rim in the document while suppressed', () => {
    for (const seed of SEEDS) {
      const out = remix(flat, seed, deps)
      // Still present and still editable — the renderer, not the data, hides it.
      expect(shading(out)).toBeDefined()
      expect(accents(out)?.rim).toBeDefined()
    }
  })

  it('is untouched by remixSection and shuffleColors', () => {
    for (const section of ['background', 'orb', 'patterns', 'shading', 'accents'] as const) {
      expect(remixSection(flat, section, `flat-${section}`, deps).flat).toBe(true)
    }
    expect(shuffleColors(flat, palette, 'flat-shuffle').flat).toBe(true)
  })

  it('is not a lock: it does not appear in doc.locks', () => {
    expect(Object.keys(flat.locks)).not.toContain('flat')
  })
})

/*
 * Solid fills is the second standing constraint, and it holds by the same
 * contract as flat: survives any remix, never turned on by one, and changes
 * nothing in the document but the flag — the gradients it suppresses must
 * come back exactly when it is toggled off.
 */
describe('solid fills', () => {
  const solid: OrbDoc = { ...FIXTURE, solidFills: true }
  const SEEDS = ['sf1', 'sf2', 'sf3', 'sf4']

  it('survives remix, remixSection and shuffleColors; never turned on', () => {
    for (const seed of SEEDS) {
      expect(remix(solid, seed, deps).solidFills).toBe(true)
      expect(remix(FIXTURE, seed, deps).solidFills).toBe(false)
    }
    for (const section of ['background', 'orb', 'patterns', 'shading', 'accents'] as const) {
      expect(remixSection(solid, section, `sf-${section}`, deps).solidFills).toBe(true)
    }
    expect(shuffleColors(solid, palette, 'sf-shuffle').solidFills).toBe(true)
  })

  it('changes nothing but the flag, so toggling it off restores gradients exactly', () => {
    for (const seed of SEEDS) {
      const solidOut = remix(solid, seed, deps)
      const plainOut = remix(FIXTURE, seed, deps)
      expect(json({ ...solidOut, solidFills: false })).toBe(json(plainOut))
    }
  })
})

describe('locked sections keep their stack position, not just their contents', () => {
  // A deliberately non-canonical stack: accent mid-stack, shading last.
  const arranged: OrbDoc = (() => {
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
    const doc: OrbDoc = {
      ...FIXTURE,
      layers: [shading(FIXTURE)!, ps[0], accents(FIXTURE)!, ps[1]],
      locks: { ...NO_LOCKS, shading: true, patterns: true, accents: true },
    }
    for (const seed of ['sh1', 'sh2', 'sh3']) {
      expect(remix(doc, seed, deps).layers[0].kind).toBe('shading')
    }
  })
})

/*
 * The v4 lock tree: sub-locks (orb.type/size/position/structure,
 * patterns.count, colors.palette) and per-object property locks, all under the
 * same two contracts as section locks — absoluteness, and lock-independent
 * draw streams. The fixed-width remix restructure makes the second contract
 * strict: toggling ANY lock at ANY level leaves every non-locked value
 * byte-identical for the same seed, with no grandfathered exemptions.
 */

const withSubLocks = (patch: Partial<{ [K in keyof SubLocks]: Partial<SubLocks[K]> }>): OrbDoc => ({
  ...FIXTURE,
  subLocks: {
    orb: { ...FIXTURE.subLocks.orb, ...(patch.orb ?? {}) },
    patterns: { ...FIXTURE.subLocks.patterns, ...(patch.patterns ?? {}) },
    colors: { ...FIXTURE.subLocks.colors, ...(patch.colors ?? {}) },
  },
})

const SEEDS = ['t1', 't2', 't3', 't4']

describe('sub-locks are absolute', () => {
  it('orb.type keeps the incoming type while cells still re-deal', () => {
    const doc = { ...withSubLocks({ orb: { type: true } }), orbType: 'segments' as const }
    for (const seed of SEEDS) {
      const out = remix(doc, seed, deps)
      expect(out.orbType).toBe('segments')
    }
    // The cells are not pinned by a type lock: across seeds they change.
    const cells = SEEDS.map((s) => json(remix(doc, s, deps).orb.sectors))
    expect(new Set(cells).size).toBeGreaterThan(1)
  })

  it('orb.size keeps the radius; orb.position keeps cx+cy', () => {
    for (const seed of SEEDS) {
      const size = remix(withSubLocks({ orb: { size: true } }), seed, deps)
      expect(size.orb.radius).toBe(FIXTURE.orb.radius)
      const pos = remix(withSubLocks({ orb: { position: true } }), seed, deps)
      expect(pos.orb.cx).toBe(FIXTURE.orb.cx)
      expect(pos.orb.cy).toBe(FIXTURE.orb.cy)
    }
  })

  it('orb.structure keeps the chord and both row counts, not the cell contents', () => {
    const doc = withSubLocks({ orb: { structure: true } })
    const contents = new Set<string>()
    for (const seed of SEEDS) {
      const out = remix(doc, seed, deps)
      expect(out.orb.sectors.angle).toBe(FIXTURE.orb.sectors.angle)
      expect(out.orb.sectors.offset).toBe(FIXTURE.orb.sectors.offset)
      expect(out.orb.sectors.rowA.length).toBe(FIXTURE.orb.sectors.rowA.length)
      expect(out.orb.sectors.rowB.length).toBe(FIXTURE.orb.sectors.rowB.length)
      contents.add(json(out.orb.sectors.rowA))
    }
    expect(contents.size).toBeGreaterThan(1)
  })

  it('patterns.count keeps the layer count while re-rolling the layers', () => {
    const doc = withSubLocks({ patterns: { count: true } })
    for (const seed of SEEDS) {
      expect(patterns(remix(doc, seed, deps)).length).toBe(patterns(FIXTURE).length)
    }
  })

  it('sub-locks hold against the section dice too', () => {
    const doc = { ...withSubLocks({ orb: { size: true, type: true } }), orbType: 'segments' as const }
    for (const seed of SEEDS) {
      const out = remixSection(doc, 'orb', seed, deps)
      expect(out.orb.radius).toBe(doc.orb.radius)
      expect(out.orbType).toBe('segments')
    }
  })
})

describe('property locks are absolute and survive remix', () => {
  const layerLocked: OrbDoc = {
    ...FIXTURE,
    layers: FIXTURE.layers.map((l, i) =>
      l.kind === 'pattern' && i === 0
        ? { ...l, locks: { pattern: true, scale: true } }
        : l,
    ),
  }

  it('a locked layer property keeps its value; unlocked properties change', () => {
    const changedRotation = new Set<string>()
    for (const seed of SEEDS) {
      const out = patterns(remix(layerLocked, seed, deps))[0]
      const orig = patterns(layerLocked)[0]
      expect(out.patternId).toBe(orig.patternId)
      expect(out.scale).toBe(orig.scale)
      expect(out.locks).toEqual(orig.locks)
      changedRotation.add(String(out.rotation))
    }
    expect(changedRotation.size).toBeGreaterThan(1)
  })

  it('any layer lock implies the count behaves locked (existence implication)', () => {
    for (const seed of SEEDS) {
      expect(patterns(remix(layerLocked, seed, deps)).length).toBe(
        patterns(layerLocked).length,
      )
    }
  })

  const cellLocked: OrbDoc = {
    ...FIXTURE,
    orbType: 'segments',
    orb: {
      ...FIXTURE.orb,
      sectors: {
        ...FIXTURE.orb.sectors,
        rowB: FIXTURE.orb.sectors.rowB.map((f, i) =>
          i === 0 ? ({ ...f, locks: { fill: true, color: true } } as SectorFill) : f,
        ),
      },
    },
  }

  it('a locked cell keeps its fill and inks; the structure is pinned by implication', () => {
    for (const seed of SEEDS) {
      const out = remix(cellLocked, seed, deps)
      const cell = out.orb.sectors.rowB[0]
      expect(json(cell)).toBe(json(cellLocked.orb.sectors.rowB[0]))
      expect(out.orb.sectors.angle).toBe(cellLocked.orb.sectors.angle)
      expect(out.orb.sectors.rowA.length).toBe(cellLocked.orb.sectors.rowA.length)
      expect(out.orb.sectors.rowB.length).toBe(cellLocked.orb.sectors.rowB.length)
    }
  })

  it('unlocking the last child releases the implication', () => {
    const released: OrbDoc = {
      ...cellLocked,
      orb: {
        ...cellLocked.orb,
        sectors: {
          ...cellLocked.orb.sectors,
          rowB: cellLocked.orb.sectors.rowB.map((f) => ({ ...f, locks: undefined })),
        },
      },
    }
    const counts = new Set<string>()
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
      const out = remix(released, seed, deps)
      counts.add(`${out.orb.sectors.rowA.length}/${out.orb.sectors.rowB.length}/${out.orb.sectors.angle}`)
    }
    expect(counts.size).toBeGreaterThan(1)
  })

  it('shuffleColors respects a color-locked layer and cell, and still shuffles the rest', () => {
    const doc: OrbDoc = {
      ...cellLocked,
      layers: cellLocked.layers.map((l, i) =>
        l.kind === 'pattern' && i === 0 ? { ...l, locks: { color: true } } : l,
      ),
    }
    const out = shuffleColors(doc, palette, 'plock-shuffle')
    expect(json(patterns(out)[0].colors)).toBe(json(patterns(doc)[0].colors))
    expect(json(out.orb.sectors.rowB[0])).toBe(json(doc.orb.sectors.rowB[0]))
    expect(json(out)).not.toBe(json(doc))
  })
})

describe('strict stream independence — no lock at any level shifts any other value', () => {
  /** Compare two remix outputs with the guarded values — and the lock flags
   *  themselves, which are inputs, not outputs — normalized away. The pattern
   *  layer COUNT is guarded (count lock / implication), but the shared prefix
   *  must still be candidate-identical, so the first layer is kept with its
   *  guarded visibility (it follows orbType) normalized. */
  const scrub = (d: OrbDoc) => {
    const pats = patterns(d)
    return json({
      ...d,
      orbType: '<x>',
      locks: '<locks>',
      subLocks: '<locks>',
      orb: { ...d.orb, radius: 0, cx: 0, cy: 0, sectors: '<x>' },
      layers: {
        firstPattern: pats[0] ? { ...pats[0], visible: '<v>', locks: '<locks>' } : null,
        others: d.layers.filter((l) => l.kind !== 'pattern'),
      },
    })
  }

  it('holds for every sub-lock, including the count lock (no exemptions)', () => {
    const variants: OrbDoc[] = [
      withSubLocks({ orb: { type: true } }),
      withSubLocks({ orb: { size: true } }),
      withSubLocks({ orb: { position: true } }),
      withSubLocks({ orb: { structure: true } }),
      withSubLocks({ patterns: { count: true } }),
    ]
    for (const seed of SEEDS) {
      const base = scrub(remix(FIXTURE, seed, deps))
      for (const doc of variants) {
        expect(scrub(remix(doc, seed, deps))).toBe(base)
      }
    }
  })

  it('holds for property locks on layers', () => {
    const layerLocked: OrbDoc = {
      ...FIXTURE,
      layers: FIXTURE.layers.map((l, i) =>
        l.kind === 'pattern' && i === 1 ? { ...l, locks: { rotation: true } } : l,
      ),
    }
    // A property lock implies the count lock (existence implication), so its
    // stream is compared against the count-locked baseline — everything else
    // must be byte-identical.
    for (const seed of SEEDS) {
      const base = scrub(remix(withSubLocks({ patterns: { count: true } }), seed, deps))
      expect(scrub(remix(layerLocked, seed, deps))).toBe(base)
    }
  })
})

describe('v3 → v4 migration', () => {
  /** A hand-built v3 document in the legacy shape. */
  const legacy = (mode: 'disc' | 'sliced' | 'sectors', extras: Record<string, unknown> = {}) => {
    const base = defaultDoc('mig-seed') as unknown as Record<string, unknown>
    const orb = { ...(base.orb as Record<string, unknown>), mode, slices: { count: 20 } }
    const doc: Record<string, unknown> = { ...base, version: 3, orb, lockPatternCount: true, ...extras }
    delete doc.orbType
    delete doc.subLocks
    delete doc.colorSource
    return doc as unknown as OrbDoc
  }

  it('derives the type: sectors → segments, sliced → color, disc+patterns → pattern', () => {
    expect(normalizeDoc(legacy('sectors')).orbType).toBe('segments')
    expect(normalizeDoc(legacy('sliced')).orbType).toBe('color')
    expect(normalizeDoc(legacy('disc')).orbType).toBe('pattern')
  })

  it('absorbs lockPatternCount into subLocks and deletes the legacy fields', () => {
    const out = normalizeDoc(legacy('disc'))
    expect(out.subLocks.patterns.count).toBe(true)
    expect('lockPatternCount' in out).toBe(false)
    expect('mode' in out.orb).toBe(false)
    expect('slices' in out.orb).toBe(false)
    expect(out.version).toBe(4)
    expect(out.colorSource).toBe('palette')
  })
})

describe('applyOrbType respects the lock tree', () => {
  it('switches type and rewrites pattern visibility', () => {
    const out = applyOrbType(FIXTURE, 'color')
    expect(out.doc.orbType).toBe('color')
    expect(patterns(out.doc).every((l) => !l.visible)).toBe(true)
    expect(out.skipped).toEqual([])
    const back = applyOrbType(out.doc, 'pattern')
    expect(patterns(back.doc).filter((l) => l.visible).length).toBeGreaterThan(0)
  })

  it('a locked orb or type sub-lock blocks the switch and reports it', () => {
    const locked = { ...withLocks({ orb: true }) }
    const out = applyOrbType(locked, 'segments')
    expect(out.doc.orbType).toBe(locked.orbType)
    expect(out.skipped).toContain('orb')

    const sub = withSubLocks({ orb: { type: true } })
    const out2 = applyOrbType(sub, 'segments')
    expect(out2.doc.orbType).toBe(sub.orbType)
    expect(out2.skipped).toContain('orb')
  })

  it('locked patterns keep their visibility and report it', () => {
    const locked = withLocks({ patterns: true })
    const out = applyOrbType(locked, 'color')
    expect(patterns(out.doc).map((l) => l.visible)).toEqual(
      patterns(locked).map((l) => l.visible),
    )
    expect(out.skipped).toContain('patterns')
  })
})
