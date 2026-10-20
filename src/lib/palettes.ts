import type { ColorRef, Palette } from '../types'
import { hexToLab, luminance, normalizeHex } from './color'

/**
 * Built-in palettes. Slot 0 is always the darkest/ground tone and the last
 * slots trend lightest — the remix and default-mapping heuristics lean on that
 * ordering, so keep new palettes sorted the same way.
 */
export const BUILTIN_PALETTES: Palette[] = [
  /*
   * The RSAC Brand System (2026-08-25), transcribed verbatim from the brand
   * token files and admitted through the standing lightness sort. Neutrals
   * lead — "the brand leads with black and white; color arrives through the
   * named gradients" (see lib/brand.ts) — and being first makes RSAC Neutrals
   * the default palette for new documents: exactly 8 slots, the width the
   * default document assumes, so nothing clamps anywhere.
   */
  {
    id: 'rsac-neutrals',
    name: 'RSAC Neutrals',
    builtin: true,
    colors: ['#000000', '#333333', '#666666', '#BFBFBF', '#DDDDDD', '#E9E9E9', '#FDF9F6', '#FFFFFF'],
  },
  {
    // One 12-slot palette, not Main/Secondary/Library splits: the file's
    // grouping is a usage taxonomy, and the slot contract is lightness.
    id: 'rsac-spectrum',
    name: 'RSAC Spectrum',
    builtin: true,
    // Cell-deal weights (2026-10-20, Pete): the brand board's primary row
    // leads at 2 (Navy, Yellow, Aqua), secondaries at 1. Orange and red at
    // half their row — red/orange reads as alarm in security — and Light Blue
    // and Purple at half too, because as big flat fields they washed the
    // collage out. Rose (primary) at 1 and pale pink at 0.5: at 2 + 1 the two
    // pinks took ~23% of cell area and batches read pink.
    //         002F4B 00396C 436083 DB4750 EA6F53 B08ADA D893A8 E1C5CE FFC505 68F5D3 CDE0FD EEEDE9
    weights: [1,     2,     1,     0.5,   1,     0.5,   1,     0.5,   2,     2,     1,     1],
    colors: [
      '#002F4B', '#00396C', '#436083', '#DB4750', '#EA6F53', '#B08ADA',
      '#D893A8', '#E1C5CE', '#FFC505', '#68F5D3', '#CDE0FD', '#EEEDE9',
    ],
  },
  {
    // The curated Main subset — a 12-color generative deal can get
    // carnival-ish for restrained collections.
    id: 'rsac-main',
    name: 'RSAC Main',
    builtin: true,
    colors: ['#00396C', '#EA6F53', '#D893A8', '#FFC505', '#68F5D3', '#CDE0FD'],
  },

  /*{
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
*/
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

  /*
   * Sampled from the gradient strip in `Palettes/Gradients/` (Frame*.svg — the
   * PNG beside each is just a preview of the same two or three stops). The
   * eleven frames chain end-to-end into one spectrum, so they are listed in
   * strip order.
   *
   * Each gradient is sampled at six even steps, interpolated in OKLab so the
   * run matches what the SVG actually paints. Sampling alone is not enough to
   * make a usable palette, though: most of these strips barely move in
   * lightness — `Frame`/`Frame-7` span 0.002 — so a straight six-slot palette
   * has no ground to sit the orb on and no highlight, and `dealRamp` has no
   * dark/mid/light thirds to split. So each palette also carries **derived
   * anchors** at the ends the gradient does not reach: a near-black ground and
   * a mid-dark below (at OKLab L 0.10 / 0.30), a near-white tint above (L 0.95),
   * each keeping the neighbouring sample's hue at reduced chroma. Gradients
   * that already reach an end get no anchor there — `Frame-9`/`Frame-10` run
   * dark on their own, so they take only a ground.
   *
   * The sampled hexes are the palette's identity; the anchors exist to make it
   * function. If a strip is ever re-exported, re-derive both together.
   */
  {
    // Palettes/Gradients/Frame.svg — #E0DDDD → #CDE0FD.
    id: 'paper-sky',
    name: 'Paper Sky',
    builtin: true,
    colors: ['#030303', '#2f2d2d', '#e0dddd', '#dcdee4', '#d9deea', '#d5dff0', '#d1dff7', '#cde0fd'],
  },
  {
    // Palettes/Gradients/Frame-1.svg — #CDE0FD → #B08ADA.
    id: 'sky-lilac',
    name: 'Sky Lilac',
    builtin: true,
    colors: ['#05010c', '#362448', '#b08ada', '#b69be1', '#bcace8', '#c2beef', '#c8cff6', '#cde0fd'],
  },
  {
    // Palettes/Gradients/Frame-2.svg — #B08ADA → #DB4750.
    id: 'lilac-ember',
    name: 'Lilac Ember',
    builtin: true,
    colors: ['#100000', '#560f16', '#db4750', '#d45a6e', '#cc698a', '#c475a5', '#bb80c0', '#b08ada', '#f4e9ff'],
  },
  {
    // Palettes/Gradients/Frame-3.svg — #DB4750 → #EA6F53.
    id: 'ember-coral',
    name: 'Ember Coral',
    builtin: true,
    colors: ['#100000', '#560f16', '#db4750', '#de5051', '#e15851', '#e46052', '#e76853', '#ea6f53', '#ffe5db'],
  },
  {
    // Palettes/Gradients/Frame-4.svg — #EA6F53 → #F39530 → #FFC505.
    id: 'coral-sunrise',
    name: 'Coral Sunrise',
    builtin: true,
    colors: ['#0f0000', '#51190c', '#ea6f53', '#ee8147', '#f29235', '#f7a32a', '#fbb41e', '#ffc505', '#fdedca'],
  },
  {
    // Palettes/Gradients/Frame-5.svg — #DF714C → #68F5D3. The file stacks two
    // gradients; the second is opaque and fully covers the first, so only its
    // stops are sampled.
    id: 'coral-mint',
    name: 'Coral Mint',
    builtin: true,
    colors: ['#0e0000', '#4e1c0a', '#df714c', '#d58f68', '#c7ab83', '#b3c49e', '#97ddb8', '#68f5d3', '#d6f7ed'],
  },
  {
    // Palettes/Gradients/Frame-6.svg — #86D5B2 → #FDC513.
    id: 'mint-gold',
    name: 'Mint Gold',
    builtin: true,
    colors: ['#000502', '#103627', '#86d5b2', '#a3d39e', '#bcd188', '#d3ce6f', '#e9ca50', '#fdc513', '#fcedcb'],
  },
  {
    // Palettes/Gradients/Frame-7.svg — #FFC505 → #E1C5CE.
    id: 'gold-blush',
    name: 'Gold Blush',
    builtin: true,
    colors: ['#050303', '#362a2e', '#e1c5ce', '#e7c6b5', '#edc79b', '#f3c67d', '#f9c657', '#ffc505', '#fdedca'],
  },
  {
    // Palettes/Gradients/Frame-8.svg — #E1C5CE → #D893A8.
    id: 'blush-rose',
    name: 'Blush Rose',
    builtin: true,
    colors: ['#090103', '#41232d', '#d893a8', '#da9daf', '#dca7b7', '#deb1bf', '#e0bbc6', '#e1c5ce', '#f4ecee'],
  },
  {
    // Palettes/Gradients/Frame-9.svg — #D893A8 → #00396C.
    id: 'rose-navy',
    name: 'Rose Navy',
    builtin: true,
    colors: ['#00030c', '#00396c', '#384c79', '#605f85', '#877091', '#af829d', '#d893a8', '#fde8ee'],
  },
  {
    // Palettes/Gradients/Frame-10.svg — #436083 → #002F4B.
    id: 'deep-navy',
    name: 'Deep Navy',
    builtin: true,
    colors: ['#000408', '#002f4b', '#103856', '#1e4261', '#2a4c6c', '#375677', '#436083', '#e6f0fb'],
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
/**
 * "Paper" slots: near-white and near-neutral (OKLab L > 0.9, chroma < 0.03) —
 * RSAC Spectrum's #EEEDE9, the Neutrals' whites. Fine as ink, ramp ends and
 * accents, but as an *area* (a flat segment, a texture's plate) they read as
 * an empty gap — on a light Figma canvas or a transparent export, a cell that
 * looks missing. Remix keeps them out of area fills (2026-10-13: 28% of
 * default-preset remixes had one).
 */
export function paperSlots(palette: Palette): Set<number> {
  const out = new Set<number>()
  palette.colors.forEach((c, i) => {
    const { L, a, b } = hexToLab(c)
    if (L > 0.9 && Math.hypot(a, b) < 0.03) out.add(i)
  })
  return out
}

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
