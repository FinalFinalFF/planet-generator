/** localStorage persistence. Every read is defensive: bad data falls back. */

import type { Palette, OrbDoc, Preset } from '../types'
import { DOC_VERSION } from '../types'
import { normalizeDoc } from './defaults'

const KEYS = {
  doc: 'orbgen.doc.v1',
  palettes: 'orbgen.palettes.v1',
  presets: 'orbgen.presets.v1',
  patterns: 'orbgen.patterns.v1',
  ui: 'orbgen.ui.v1',
} as const

/**
 * These were `planetgen.*` before the planet→orb rename. Reading through to the
 * old key keeps a returning user's document, custom palettes, saved presets and
 * imported patterns — dropping them would look exactly like the app wiping their
 * work. The copy happens on first read and the legacy key is left in place, so
 * an accidental downgrade is not destructive.
 */
const LEGACY_PREFIX = 'planetgen.'

function read<T>(key: string): T | null {
  try {
    let raw = localStorage.getItem(key)
    if (!raw) {
      raw = localStorage.getItem(key.replace(/^orbgen\./, LEGACY_PREFIX))
      if (!raw) return null
      try {
        localStorage.setItem(key, raw)
      } catch {
        // Migrating in place is best-effort; the read below still succeeds.
      }
    }
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private-mode failures are not worth interrupting the session.
  }
}

export function loadDoc(): OrbDoc | null {
  const doc = read<OrbDoc>(KEYS.doc)
  if (!doc || typeof doc !== 'object') return null
  // A v2 document carries `planet` instead of `orb`; `normalizeDoc` renames it,
  // so this guard has to accept either or it would reject the very documents the
  // migration exists to rescue.
  const hasOrb = !!doc.orb || !!(doc as unknown as { planet?: unknown }).planet
  if (!doc.canvas || !hasOrb || !Array.isArray(doc.layers)) return null
  // Older versions are migrated rather than discarded.
  if (doc.version > DOC_VERSION) return null
  try {
    return normalizeDoc(doc)
  } catch {
    return null
  }
}

export const saveDoc = (doc: OrbDoc) => write(KEYS.doc, doc)

export function loadPalettes(): Palette[] {
  const list = read<Palette[]>(KEYS.palettes)
  if (!Array.isArray(list)) return []
  return list.filter(
    (p): p is Palette =>
      !!p && typeof p.id === 'string' && Array.isArray(p.colors) && p.colors.length > 0,
  )
}

export const savePalettes = (palettes: Palette[]) =>
  write(KEYS.palettes, palettes.filter((p) => !p.builtin))

export function loadPresets(): Preset[] {
  const list = read<Preset[]>(KEYS.presets)
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is Preset => !!p && typeof p.id === 'string' && !!p.doc)
    .flatMap((p) => {
      try {
        return [{ ...p, doc: normalizeDoc(p.doc) }]
      } catch {
        return []
      }
    })
}

export const savePresets = (presets: Preset[]) => write(KEYS.presets, presets)

/* ---------- imported patterns ---------- */

/**
 * Dropped SVGs are kept so a composition survives a reload. Bounded, because
 * these files run to hundreds of KB and localStorage is a few MB total —
 * blowing the quota here would also take the document and presets down with it.
 */
const IMPORT_FILE_CAP = 512 * 1024
const IMPORT_TOTAL_CAP = 3 * 1024 * 1024

export type StoredPattern = { id: string; name: string; raw: string }

export function loadImportedPatterns(): StoredPattern[] {
  const list = read<StoredPattern[]>(KEYS.patterns)
  if (!Array.isArray(list)) return []
  return list.filter(
    (p): p is StoredPattern =>
      !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.raw === 'string',
  )
}

/** Returns the ids that did not fit, so the caller can say so. */
export function saveImportedPatterns(list: StoredPattern[]): string[] {
  const kept: StoredPattern[] = []
  const dropped: string[] = []
  let total = 0
  // Newest first, so the most recent import is the one that survives.
  for (const p of [...list].reverse()) {
    const size = p.raw.length
    if (size > IMPORT_FILE_CAP || total + size > IMPORT_TOTAL_CAP) {
      dropped.push(p.id)
      continue
    }
    total += size
    kept.unshift(p)
  }
  try {
    localStorage.setItem(KEYS.patterns, JSON.stringify(kept))
  } catch {
    // Quota refused even the trimmed set: keep them in memory only.
    return list.map((p) => p.id)
  }
  return dropped
}

export type UiState = {
  zoom: number
  fitToStage: boolean
  openSections: string[]
  selectedLayerId: string | null
}

export function loadUi(): Partial<UiState> | null {
  const ui = read<Partial<UiState>>(KEYS.ui)
  if (!ui?.openSections) return ui
  // The orb section's key used to be 'planet'; without this the section a user
  // left open comes back collapsed.
  return { ...ui, openSections: ui.openSections.map((k) => (k === 'planet' ? 'orb' : k)) }
}
export const saveUi = (ui: UiState) => write(KEYS.ui, ui)
