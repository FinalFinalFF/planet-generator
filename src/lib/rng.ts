/** Seeded RNG. Any seed string maps deterministically to the same stream. */

export type Rng = {
  next(): number
  float(min: number, max: number): number
  int(min: number, max: number): number
  bool(p?: number): boolean
  pick<T>(arr: readonly T[]): T
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(arr: readonly T[]): T[]
  /** Weighted pick: weights parallel to items. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
}

function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function makeRng(seed: string): Rng {
  let a = hashSeed(seed) || 0x9e3779b9
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    bool: (p = 0.5) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    weighted: (items, weights) => {
      const total = weights.reduce((s, w) => s + w, 0)
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },
  }
  return rng
}

const ADJ = [
  'ashen', 'amber', 'basalt', 'cobalt', 'cinder', 'dusk', 'ember', 'flint',
  'glass', 'halo', 'ion', 'jade', 'kelp', 'lumen', 'mica', 'nova',
  'onyx', 'prism', 'quartz', 'rust', 'slate', 'tidal', 'umber', 'vapor',
]
const NOUN = [
  'arc', 'belt', 'coil', 'drift', 'echo', 'flux', 'gate', 'husk',
  'iris', 'jet', 'knot', 'lace', 'moon', 'node', 'orbit', 'pulse',
  'ring', 'shard', 'trace', 'veil', 'wake', 'zone', 'span', 'core',
]

/** Human-friendly seed like `ember-orbit-47`. */
export function randomSeed(): string {
  const r = Math.random
  const a = ADJ[Math.floor(r() * ADJ.length)]
  const n = NOUN[Math.floor(r() * NOUN.length)]
  return `${a}-${n}-${Math.floor(r() * 900 + 100)}`
}
