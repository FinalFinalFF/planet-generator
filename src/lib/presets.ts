/**
 * Shipped presets — the same pattern as `BUILTIN_PALETTES`: curated documents
 * baked into the build so every user sees them, marked `builtin` (loadable,
 * not deletable). One may carry `default: true`, and a brand-new visitor's
 * first document *is* that preset; returning visitors always get their own
 * persisted document instead.
 *
 * To add one: design in the app, use the header's export-presets action to
 * download the JSON, and paste the preset's object here (the doc runs through
 * `normalizeDoc` on load, so older shapes keep working).
 */

import type { OrbDoc, Preset } from '../types'
import { normalizeDoc } from './defaults'

export const BUILTIN_PRESETS: Preset[] = [
  // Curated presets land here — none shipped yet.
]

/** The default-flagged builtin's document, normalized, or null if none. */
export function defaultPresetDoc(): OrbDoc | null {
  const preset = BUILTIN_PRESETS.find((p) => p.default)
  if (!preset) return null
  try {
    return normalizeDoc(structuredClone(preset.doc))
  } catch {
    return null
  }
}
