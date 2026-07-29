import { useEffect, useState } from 'react'
import type { Preset } from '../types'

export function Header({
  seed,
  canUndo,
  canRedo,
  presets,
  colorsLocked,
  onRemix,
  onRemixAll,
  onShuffleColors,
  onSeedChange,
  onUndo,
  onRedo,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}: {
  seed: string
  canUndo: boolean
  canRedo: boolean
  presets: Preset[]
  /** Remix All leaves the palette alone when colors are locked; say so. */
  colorsLocked: boolean
  onRemix: () => void
  onRemixAll: () => void
  onShuffleColors: () => void
  onSeedChange: (seed: string) => void
  onUndo: () => void
  onRedo: () => void
  onSavePreset: (name: string) => void
  onLoadPreset: (id: string) => void
  onDeletePreset: (id: string) => void
}) {
  const [draft, setDraft] = useState(seed)
  const [presetId, setPresetId] = useState('')
  useEffect(() => setDraft(seed), [seed])

  const commitSeed = () => {
    const next = draft.trim()
    if (next && next !== seed) onSeedChange(next)
    else setDraft(seed)
  }

  return (
    <header className="header">
      <div className="header__brand">
        FinalFinal™ <span>Planet Generator</span>
      </div>

      <div className="header__rule" />

      <div className="header__group">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onRemixAll}
          title={
            colorsLocked
              ? 'Remix All (⇧R) — colors are locked, so the palette will not change'
              : 'Remix All (⇧R) — everything, including a new palette'
          }
        >
          Remix All
        </button>
        <button
          type="button"
          className="btn"
          onClick={onRemix}
          title="Remix (R) — keeps the active palette"
        >
          Remix
        </button>
        <button
          type="button"
          className="btn"
          onClick={onShuffleColors}
          disabled={colorsLocked}
          title={
            colorsLocked
              ? 'Colors are locked — unlock the Palette section to shuffle'
              : 'Shuffle colors (S)'
          }
        >
          Shuffle colors
        </button>
      </div>

      <div className="header__group">
        <span className="eyebrow">seed</span>
        <input
          className="text"
          style={{ width: 168 }}
          value={draft}
          aria-label="Seed"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitSeed}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitSeed()
            if (e.key === 'Escape') setDraft(seed)
          }}
        />
      </div>

      <div className="header__spacer" />

      <div className="header__group">
        <button
          type="button"
          className="btn btn--icon"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
        >
          ↷
        </button>
      </div>

      <div className="header__rule" />

      <div className="header__group">
        <select
          className="select"
          style={{ width: 150 }}
          value={presetId}
          aria-label="Presets"
          onChange={(e) => {
            const id = e.target.value
            setPresetId(id)
            if (id) onLoadPreset(id)
          }}
        >
          <option value="">Presets…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const name = window.prompt('Preset name', `Planet ${seed}`)
            if (name?.trim()) onSavePreset(name.trim())
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn--icon"
          disabled={!presetId}
          title="Delete selected preset"
          aria-label="Delete selected preset"
          onClick={() => {
            if (!presetId) return
            const p = presets.find((x) => x.id === presetId)
            if (p && window.confirm(`Delete preset “${p.name}”?`)) {
              onDeletePreset(presetId)
              setPresetId('')
            }
          }}
        >
          ✕
        </button>
      </div>
    </header>
  )
}
