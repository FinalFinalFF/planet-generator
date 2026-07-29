/** localStorage persistence. Every read is defensive: bad data falls back. */

import type { Palette, PlanetDoc, Preset } from '../types'
import { DOC_VERSION } from '../types'
import { normalizeDoc } from './defaults'

const KEYS = {
  doc: 'planetgen.doc.v1',
  palettes: 'planetgen.palettes.v1',
  presets: 'planetgen.presets.v1',
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

export type UiState = {
  zoom: number
  fitToStage: boolean
  openSections: string[]
  selectedLayerId: string | null
}

export const loadUi = () => read<Partial<UiState>>(KEYS.ui)
export const saveUi = (ui: UiState) => write(KEYS.ui, ui)
