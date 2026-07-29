import type { ColorRef, Palette } from '../types'
import { luminance, normalizeHex } from './color'

/**
 * Built-in palettes. Slot 0 is always the darkest/ground tone and the last
 * slots trend lightest — the remix and default-mapping heuristics lean on that
 * ordering, so keep new palettes sorted the same way.
 */
export const BUILTIN_PALETTES: Palette[] = [
  {
    id: 'ember-terminator',
    name: 'Ember Terminator',
    builtin: true,
    colors: ['#05090a', '#0f3f3a', '#149484', '#5ecfc0', '#d8342a', '#f4692c', '#f7b93f', '#faf0c8'],
  },
  {
    id: 'pale-sky-brights',
    name: 'Pale Sky Brights',
    builtin: true,
    colors: ['#0c2f8f', '#1f47d6', '#2f9bef', '#7bd2f7', '#b7e6fb', '#2fd39c', '#a8e82b', '#ff6a2b'],
  },
  {
    id: 'circuit-jade',
    name: 'Circuit Jade',
    builtin: true,
    colors: ['#070d0c', '#0d2320', '#166f61', '#278576', '#4fc0aa', '#9be7d3', '#e7f6f0', '#f2d94e'],
  },
  {
    id: 'bauhaus-signal',
    name: 'Bauhaus Signal',
    builtin: true,
    colors: ['#111112', '#3a3b3d', '#8f9194', '#d1d3d4', '#f2f2f0', '#ff2266', '#fea5e9', '#ffd166'],
  },
  {
    id: 'violet-drive',
    name: 'Violet Drive',
    builtin: true,
    colors: ['#08050f', '#1b0f4a', '#3a1fd0', '#5327ff', '#a34bf0', '#c933b9', '#f00758', '#a7d922'],
  },
  {
    id: 'oxide-dust',
    name: 'Oxide Dust',
    builtin: true,
    colors: ['#100b09', '#2f1d16', '#7b3a1e', '#c2551f', '#e0873c', '#efc07a', '#f6e6cd', '#4a6b66'],
  },
  {
    // The brand-system reference: near-black green ground under brights,
    // with a true white for crisp line work.
    id: 'signal-dark',
    name: 'Signal Dark',
    builtin: true,
    colors: ['#08150f', '#0d2b22', '#12a94e', '#e94ec7', '#9b7cf5', '#f96a4a', '#bcdcd2', '#d4e02a', '#ffffff'],
  },

  /*
   * Sampled from the boards in `Palettes/`. Anchor colors are read straight off
   * the source; where a reference gave fewer than ~6 tones, intermediates were
   * interpolated so the dark/mid/light thirds the remix deck needs all exist.
   */
  {
    // Palettes/Group 458.png — cyan and violet over near-black.
    id: 'aurora-signal',
    name: 'Aurora Signal',
    builtin: true,
    colors: ['#0e0615', '#1c0f38', '#4a1fb0', '#7c3de5', '#209fcc', '#a97cf0', '#7fd6ea', '#fdf9ff'],
  },
  {
    // Palettes/image 31.png, which names its own swatches: Neverything,
    // Ateneo Blue, Miami Coral, Sea Buckthorn, Polar Drift, Magical Moonlight.
    // Palettes/Group 459.png is the same set.
    id: 'coral-ateneo',
    name: 'Coral Ateneo',
    builtin: true,
    colors: ['#13181b', '#003a6c', '#1f5f96', '#c25a4e', '#fd8973', '#ffbf65', '#ccd5da', '#f0eeeb'],
  },
  {
    // Palettes/image 1.png — teal-to-ember stack on a pale green ground.
    id: 'retoka-bloom',
    name: 'Pale Ember',
    builtin: true,
    colors: ['#15191a', '#013546', '#146d72', '#cf2511', '#20c6ad', '#f39b17', '#fed372', '#e5ebc7'],
  },
  {
    // Palettes/image 32.png — the twilight→dawn→noon→sunset→night sequence.
    id: 'golden-hours',
    name: 'Golden Hours',
    builtin: true,
    colors: ['#02122c', '#164a7c', '#0364b5', '#18a3a0', '#f75838', '#cdb49f', '#f7ba78', '#f5edeb'],
  },
  {
    // Palettes/image 24.png — saturated gradient tiles on near-black.
    id: 'neon-vapour',
    name: 'Neon Vapour',
    builtin: true,
    colors: ['#111111', '#2a0a3a', '#602484', '#f0300c', '#e46ccc', '#84ccfc', '#54e478', '#cce40c'],
  },
  {
    // Palettes/image 30.png — cobalt ground with ink, lilac, amber and white.
    id: 'cobalt-pixel',
    name: 'Cobalt Pixel',
    builtin: true,
    colors: ['#272324', '#123a70', '#2772d5', '#5f9ce8', '#cf9de5', '#fda307', '#e8e2ee', '#fdfdfd'],
  },
  {
    // Palettes/image 6.png — charcoal posters lit by blue and amber bloom.
    id: 'kindleworth-ember',
    name: 'Charcoal Bloom',
    builtin: true,
    colors: ['#0d0d0d', '#0e2a46', '#1c4662', '#2a708c', '#9a5438', '#469a9a', '#d28c54', '#f0e6d8'],
  },
]

export function paletteById(palettes: Palette[], id: string): Palette {
  return palettes.find((p) => p.id === id) ?? palettes[0] ?? BUILTIN_PALETTES[0]
}

/**
 * Resolve a ColorRef against a palette. Never returns an invalid color.
 *
 * Out-of-range slots **clamp** rather than wrap. Wrapping sends a slot past the
 * light end straight back to the darkest color, which puts a hard black band in
 * the middle of any gradient authored against a longer palette — and short
 * palettes are common, since pasting a list of four hex codes makes one.
 */
export function resolveColor(ref: ColorRef | undefined, palette: Palette): string {
  if (!ref) return '#000000'
  if (ref.hex) return normalizeHex(ref.hex) ?? '#000000'
  const colors = palette.colors.length ? palette.colors : BUILTIN_PALETTES[0].colors
  const slot = Math.min(Math.max(Math.round(ref.slot), 0), colors.length - 1)
  return normalizeHex(colors[slot]) ?? '#000000'
}

export function refAlpha(ref: ColorRef | undefined): number {
  const a = ref?.alpha
  return a === undefined || a === null ? 1 : a
}

/** Palette slot indices sorted from darkest to lightest. */
export function slotsByLightness(palette: Palette): number[] {
  return palette.colors
    .map((c, i) => ({ i, L: luminance(c) }))
    .sort((a, b) => a.L - b.L)
    .map((x) => x.i)
}

export function newPaletteId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base || 'palette'}-${Math.random().toString(36).slice(2, 7)}`
}
