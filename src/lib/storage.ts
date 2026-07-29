/** localStorage persistence. Every read is defensive: bad data falls back. */

import type { Palette, PlanetDoc, Preset } from '../types'
import { DOC_VERSION } from '../types'
import { normalizeDoc } from './defaults'

const KEYS = {
  doc: 'planetgen.doc.v1',
  palettes: 'planetgen.palettes.v1',
  presets: 'planetgen.presets.v1',
  patterns: 'planetgen.patterns.v1',
  ui: 'planetgen.ui.v1',
} as const

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
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

export function loadDoc(): PlanetDoc | null {
  const doc = read<PlanetDoc>(KEYS.doc)
  if (!doc || typeof doc !== 'object') return null
  if (!doc.canvas || !doc.planet || !Array.isArray(doc.layers)) return null
  // Older versions are migrated rather than discarded.
  if (doc.version > DOC_VERSION) return null
  try {
    return normalizeDoc(doc)
  } catch {
    return null
  }
}

export const saveDoc = (doc: PlanetDoc) => write(KEYS.doc, doc)

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

export const loadUi = () => read<Partial<UiState>>(KEYS.ui)
export const saveUi = (ui: UiState) => write(KEYS.ui, ui)
