/**
 * Color utilities. Everything internally is sRGB hex; perceptual work happens
 * in OKLab so pattern recoloring keeps gradients reading as gradients.
 */

export type RGB = { r: number; g: number; b: number } // 0..255
export type Lab = { L: number; a: number; b: number }

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  maroon: '#800000',
  olive: '#808000',
  green: '#008000',
  purple: '#800080',
  teal: '#008080',
  navy: '#000080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  indigo: '#4b0082',
  violet: '#ee82ee',
  salmon: '#fa8072',
  crimson: '#dc143c',
  khaki: '#f0e68c',
  turquoise: '#40e0d0',
  tan: '#d2b48c',
  plum: '#dda0dd',
  orchid: '#da70d6',
  coral: '#ff7f50',
  tomato: '#ff6347',
  wheat: '#f5deb3',
  snow: '#fffafa',
  linen: '#faf0e6',
  azure: '#f0ffff',
  lavender: '#e6e6fa',
  transparent: '#00000000',
}

/**
 * Normalize any CSS color literal we care about to lowercase `#rrggbb`. Returns
 * null if unparseable.
 *
 * **Fully transparent literals also return null**, deliberately. Alpha is
 * tracked separately, so stripping it would turn `transparent` — which is
 * `#00000000` in the named table — into opaque black. In pattern parsing that
 * promoted invisible source geometry into paintable black ink that appeared as
 * soon as the pattern was recolored. Treating it as "not a color", the same as
 * `none`, leaves such geometry untouched.
 */
export function normalizeHex(raw: string): string | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase()
  if (NAMED[s]) s = NAMED[s]
  if (s.startsWith('rgb')) {
    const nums = s.match(/[\d.]+/g)
    if (!nums || nums.length < 3) return null
    const [r, g, b] = nums.slice(0, 3).map((n) => clamp(Math.round(parseFloat(n)), 0, 255))
    return rgbToHex({ r, g, b })
  }
  if (!s.startsWith('#')) return null
  const body = s.slice(1)
  if (body.length === 3 || body.length === 4) {
    if (body.length === 4 && body[3] === '0') return null // #rgb0
    const [r, g, b] = [body[0], body[1], body[2]]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (body.length === 6) return `#${body}`
  if (body.length === 8) {
    if (body.slice(6) === '00') return null // #rrggbb00, and so `transparent`
    return `#${body.slice(0, 6)}` // drop alpha; we track alpha separately
  }
  return null
}

export function isColorLiteral(raw: string): boolean {
  return normalizeHex(raw) !== null
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex) ?? '#000000'
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/* ---------- OKLab ---------- */

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}
function linearToSrgb(x: number): number {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
  return clamp(c * 255, 0, 255)
}

export function hexToLab(hex: string): Lab {
  const { r, g, b } = hexToRgb(hex)
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function labToHex({ L, a, b }: Lab): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return rgbToHex({
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  })
}

export function labDistance(a: Lab, b: Lab): number {
  const dL = (a.L - b.L) * 1.6 // weight lightness a bit: keeps light/dark ink apart
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

export function luminance(hex: string): number {
  return hexToLab(hex).L
}

/** Shift a color's OKLab lightness by `delta`, keeping hue/chroma. */
export function shiftLightness(hex: string, delta: number): string {
  const lab = hexToLab(hex)
  return labToHex({ ...lab, L: clamp(lab.L + delta, 0, 1) })
}

export function mixHex(a: string, b: string, t: number): string {
  const la = hexToLab(a)
  const lb = hexToLab(b)
  return labToHex({
    L: la.L + (lb.L - la.L) * t,
    a: la.a + (lb.a - la.a) * t,
    b: la.b + (lb.b - la.b) * t,
  })
}

/** `#rrggbb` + alpha 0..1 → `rgba()` free `#rrggbbaa` (SVG 2 / all modern browsers). */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const a = clamp(Math.round(alpha * 255), 0, 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex}${a}`
}

/** Parse a free-form blob of text into a list of hex colors. */
export function parseHexList(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba)\([^)]*\)/g
  for (const m of text.match(re) ?? []) {
    const hex = normalizeHex(m)
    if (hex && !seen.has(hex)) {
      seen.add(hex)
      out.push(hex)
    }
  }
  if (out.length === 0) {
    // Fall back to bare 6-digit hex without `#`
    for (const m of text.match(/\b[0-9a-fA-F]{6}\b/g) ?? []) {
      const hex = `#${m.toLowerCase()}`
      if (!seen.has(hex)) {
        seen.add(hex)
        out.push(hex)
      }
    }
  }
  return out
}
