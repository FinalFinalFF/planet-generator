import { useRef, useState } from 'react'
import type { Palette } from '../types'
import { normalizeHex, parseHexList } from '../lib/color'
import { Field, TextField } from './controls'

export type PalettePanelProps = {
  palette: Palette
  palettes: Palette[]
  onSetActive: (id: string) => void
  onCreate: (name: string, colors: string[]) => void
  onUpdate: (id: string, patch: Partial<Palette>) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onImport: (json: string) => void
  onExport: () => void
}

export function PalettePanel({
  palette,
  palettes,
  onSetActive,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  onImport,
  onExport,
}: PalettePanelProps) {
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parsed = parseHexList(paste)

  return (
    <>
      <Field label="Active palette">
        <select
          className="select"
          value={palette.id}
          aria-label="Active palette"
          onChange={(e) => onSetActive(e.target.value)}
        >
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtin ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`Slots — ${palette.colors.length}`}>
        <div className="slots">
          {palette.colors.map((hex, i) => (
            <label key={`${hex}-${i}`} className="slot" style={{ background: hex }} title={`Slot ${i} — ${hex}`}>
              <span className="slot__idx">{i}</span>
              <input
                type="color"
                value={normalizeHex(hex) ?? '#000000'}
                aria-label={`Slot ${i} color`}
                disabled={!!palette.builtin}
                style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                onChange={(e) => {
                  const colors = palette.colors.slice()
                  colors[i] = e.target.value
                  onUpdate(palette.id, { colors })
                }}
              />
            </label>
          ))}
        </div>
      </Field>

      {palette.builtin ? (
        <div className="note">
          Built-in palettes are read-only. Duplicate it to edit the slots — everything in the
          composition points at slot indices, so the artwork recolors as soon as you switch.
        </div>
      ) : (
        <>
          <TextField
            label="Palette name"
            value={palette.name}
            mono={false}
            onCommit={(name) => name.trim() && onUpdate(palette.id, { name: name.trim() })}
          />
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => onUpdate(palette.id, { colors: [...palette.colors, '#888888'] })}
            >
              + Slot
            </button>
            <button
              type="button"
              className="btn"
              disabled={palette.colors.length <= 2}
              onClick={() => onUpdate(palette.id, { colors: palette.colors.slice(0, -1) })}
            >
              − Slot
            </button>
          </div>
        </>
      )}

      <div className="row">
        <button type="button" className="btn" onClick={() => onDuplicate(palette.id)}>
          Duplicate
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!palette.builtin || palettes.length <= 1}
          onClick={() => {
            if (window.confirm(`Delete palette “${palette.name}”?`)) onDelete(palette.id)
          }}
        >
          Delete
        </button>
      </div>

      <hr className="divider" />

      <Field label="Paste hex codes to create a palette">
        <textarea
          className="textarea"
          value={paste}
          placeholder="#05090a, #149484, #d8342a #f7b93f&#10;rgb(250,240,200)"
          aria-label="Hex codes"
          onChange={(e) => setPaste(e.target.value)}
        />
      </Field>
      <div className="slots">
        {parsed.map((hex, i) => (
          <span key={`${hex}-${i}`} className="slot" style={{ background: hex }} title={hex} />
        ))}
      </div>
      <button
        type="button"
        className="btn btn--block"
        disabled={parsed.length < 2}
        onClick={() => {
          const name = window.prompt('Palette name', 'Pasted palette')
          if (name?.trim()) {
            onCreate(name.trim(), parsed)
            setPaste('')
          }
        }}
      >
        Create palette from {parsed.length} color{parsed.length === 1 ? '' : 's'}
      </button>

      <hr className="divider" />

      <div className="row">
        <button type="button" className="btn" onClick={onExport}>
          Export JSON
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="offstage"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          onImport(await file.text())
        }}
      />
      <div className="note">
        Export writes every non-built-in palette as JSON. Import accepts that file, a bare array of
        palettes, or a single palette object.
      </div>
    </>
  )
}
