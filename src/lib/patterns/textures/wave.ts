/**
 * Procedural "wave" texture: a field of parallel hairline rules displaced by
 * a wave whose amplitude travels across the field — calm at the tile edges,
 * deep S-curves in the middle (the op-art poster look in
 * Examples/2026-08-25). Sine gives the smooth op-art field; zigzag gives the
 * crisp triangular rules from the panel reference.
 *
 * Output is a complete SVG document string that satisfies the pattern
 * pipeline contract in `../parse.ts`: 400×400 tile, a full-bleed background
 * plate as the first child (hidden by the app by default), one ink hex on
 * plain `<polyline>` elements, no defs/gradients/masks/opacity,
 * deterministic.
 *
 * Tiling: `periods`, `envelopePeriods` and `phasePeriods` are counted per
 * tile and rounded to whole numbers, so the displacement, its slope, the
 * amplitude envelope and the phase travel are all periodic over 400 on both
 * axes. Lines whose swing overhangs one side are re-emitted on the other
 * (their base coordinate shifted by ±400), so the 2×2 repeat has no seam.
 */

export type WaveParams = {
  /** Number of rule lines per tile; spacing is 400 / lineCount. */
  lineCount: number
  /** Stroke width in tile units. */
  strokeWidth: number
  /** Peak displacement of a line from its resting position, in tile units. */
  amplitude: number
  /**
   * Whole wave periods along each line's 400-unit run. Rounded to an
   * integer (min 1) so a line leaves the tile with the offset and slope it
   * entered with — the vertical-tiling contract.
   */
  periods: number
  /**
   * Amplitude-envelope cycles across the field. 0 means a uniform field at
   * full amplitude; 1 is the reference look — calm at the tile edges,
   * swelling to full amplitude mid-tile. Rounded to an integer so the
   * envelope is equal at 0 and 400.
   */
  envelopePeriods: number
  /**
   * Envelope floor, 0–1. The calm regions keep this fraction of the
   * amplitude, so 0 renders them as dead-straight rules.
   */
  envelopeMin: number
  /**
   * Phase-travel cycles across the field. Each line's wave is shifted by
   * this much phase per tile width, which makes the S-curves crawl
   * diagonally like the poster. Rounded to an integer for seamlessness;
   * 0 keeps every line in phase.
   */
  phasePeriods: number
  /** `sine` for smooth op-art curves, `zigzag` for straight-segment rules. */
  waveform: 'sine' | 'zigzag'
  /** `vertical`: lines run top-to-bottom, displaced in x. `horizontal`: the transpose. */
  orientation: 'vertical' | 'horizontal'
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'
const TAU = Math.PI * 2

const round2 = (n: number): number => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/** Amplitude envelope at base coordinate u. Periodic over the tile. */
const envelopeAt = (u: number, cycles: number, floor: number): number => {
  if (cycles <= 0) return 1
  const swell = 0.5 * (1 - Math.cos((TAU * cycles * u) / TILE))
  return floor + (1 - floor) * swell
}

/** Triangle wave matching sin's phase: tri(π/2) = 1, tri(3π/2) = -1. */
const tri = (theta: number): number => (2 / Math.PI) * Math.asin(Math.sin(theta))

export function waveSvg(params: WaveParams): string {
  const { strokeWidth, amplitude, envelopeMin, waveform, orientation } = params
  const lineCount = Math.max(1, Math.floor(params.lineCount))
  const periods = Math.max(1, Math.round(params.periods))
  const envCycles = Math.max(0, Math.round(params.envelopePeriods))
  const phaseCycles = Math.round(params.phasePeriods)

  const spacing = TILE / lineCount
  const k = (TAU * periods) / TILE

  // Lines whose swing (plus stroke) can reach into the tile from beyond
  // either side must be drawn too — they are the wrap-around copies of the
  // edge lines, which is what makes the cross-line axis tile seamlessly.
  const overhang = amplitude + strokeWidth
  const iStart = Math.ceil(-overhang / spacing - 0.5)
  const iEnd = Math.floor((TILE + overhang) / spacing - 0.5)

  // Sample count for the sine form: enough per period to read as a smooth
  // curve, capped to keep the default tile well under the size budget.
  const samples = Math.min(192, Math.max(64, periods * 32))

  const lines: string[] = []
  for (let i = iStart; i <= iEnd; i++) {
    const base = (i + 0.5) * spacing
    const amp = amplitude * envelopeAt(base, envCycles, envelopeMin)
    const phase = (TAU * phaseCycles * base) / TILE

    // Along-axis sample positions (t) for this line. Sine samples uniformly;
    // zigzag places vertices exactly at the wave extrema so segments stay
    // dead straight and the tips stay sharp.
    const ts: number[] = []
    if (waveform === 'sine') {
      for (let s = 0; s <= samples; s++) ts.push((TILE * s) / samples)
    } else {
      ts.push(0)
      const nStart = Math.floor((phase - Math.PI / 2) / Math.PI)
      const nEnd = Math.ceil((k * TILE + phase - Math.PI / 2) / Math.PI)
      for (let n = nStart; n <= nEnd; n++) {
        const t = (Math.PI / 2 + n * Math.PI - phase) / k
        if (t > 1e-6 && t < TILE - 1e-6) ts.push(t)
      }
      ts.push(TILE)
    }

    const pts: string[] = []
    for (const t of ts) {
      const w = waveform === 'sine' ? Math.sin(k * t + phase) : tri(k * t + phase)
      const v = base + amp * w
      pts.push(
        orientation === 'vertical'
          ? `${round2(v)},${round2(t)}`
          : `${round2(t)},${round2(v)}`,
      )
    }
    lines.push(
      `<polyline fill="none" stroke="${INK}" stroke-width="${round2(strokeWidth)}" points="${pts.join(' ')}"/>`,
    )
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>`,
    ...lines,
    `</svg>`,
  ].join('\n')
}

export const WAVE_VARIANTS: ReadonlyArray<{ id: string; name: string; params: WaveParams }> = [
  {
    id: 'tx-wave-op-field',
    name: 'Op Field',
    params: {
      lineCount: 46,
      strokeWidth: 2,
      amplitude: 26,
      periods: 1,
      envelopePeriods: 1,
      envelopeMin: 0.05,
      phasePeriods: 1,
      waveform: 'sine',
      orientation: 'vertical',
    },
  },
  {
    id: 'tx-wave-zigzag',
    name: 'Zigzag Rules',
    params: {
      lineCount: 28,
      strokeWidth: 2.5,
      amplitude: 11,
      periods: 6,
      envelopePeriods: 1,
      envelopeMin: 0.12,
      phasePeriods: 0,
      waveform: 'zigzag',
      orientation: 'vertical',
    },
  },
  {
    id: 'tx-wave-swell',
    name: 'Calm Swell',
    params: {
      lineCount: 22,
      strokeWidth: 3.5,
      amplitude: 15,
      periods: 1,
      envelopePeriods: 0,
      envelopeMin: 1,
      phasePeriods: 1,
      waveform: 'sine',
      orientation: 'horizontal',
    },
  },
]
