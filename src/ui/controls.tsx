/** Small, uniform control primitives. Every continuous value gets both a
 *  slider and a numeric input, per the brief. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import { clamp, normalizeHex } from '../lib/color'
import { refAlpha, resolveColor } from '../lib/palettes'
import type { ColorRef, Palette } from '../types'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {hint != null && <span>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  decimals,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const places = decimals ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value.toFixed(places)

  const commit = (raw: string) => {
    const parsed = parseFloat(raw)
    setDraft(null)
    if (!Number.isNaN(parsed)) onChange(clamp(parsed, min, max))
  }

  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {suffix != null && <span>{suffix}</span>}
      </div>
      <div className="field__row">
        <input
          className="slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          className="num"
          type="text"
          inputMode="decimal"
          value={shown}
          aria-label={`${label} value`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      </div>
    </div>
  )
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    const parsed = parseFloat(raw)
    setDraft(null)
    if (!Number.isNaN(parsed)) onChange(clamp(Math.round(parsed / step) * step, min, max))
  }
  return (
    <Field label={label}>
      <input
        className="text"
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    </Field>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const body = (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg__btn${o.value === value ? ' seg__btn--on' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
  return label ? <Field label={label}>{body}</Field> : body
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function TextField({
  label,
  value,
  placeholder,
  onCommit,
  mono = true,
}: {
  label?: string
  value: string
  placeholder?: string
  onCommit: (v: string) => void
  mono?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const body = (
    <input
      className="text"
      style={mono ? undefined : { fontFamily: 'var(--ff-font-body)', fontSize: 12 }}
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value)
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
  return label ? <Field label={label}>{body}</Field> : body
}

/* ---------- palette slot picker ---------- */

export function SlotStrip({
  palette,
  slot,
  onPick,
}: {
  palette: Palette
  slot: number
  onPick: (slot: number) => void
}) {
  return (
    <div className="slots">
      {palette.colors.map((hex, i) => (
        <button
          key={`${hex}-${i}`}
          type="button"
          className={`slot${i === slot ? ' slot--on' : ''}`}
          style={{ background: hex }}
          title={`Slot ${i} — ${hex}`}
          aria-label={`Slot ${i}, ${hex}`}
          aria-pressed={i === slot}
          onClick={() => onPick(i)}
        >
          <span className="slot__idx">{i}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Editor for a single ColorRef: pick a palette slot, optionally pin a literal
 * hex override, and set alpha.
 */
export function ColorRefEditor({
  name,
  chip,
  value,
  palette,
  showAlpha = true,
  onChange,
}: {
  name: string
  /** Optional original-color chip, used by pattern color groups. */
  chip?: string
  value: ColorRef
  palette: Palette
  showAlpha?: boolean
  onChange: (next: ColorRef) => void
}) {
  const resolved = resolveColor(value, palette)
  const alpha = refAlpha(value)
  const overridden = !!value.hex

  return (
    <div className="colorref">
      <div className="colorref__head">
        {chip && <span className="colorref__chip" style={{ background: chip }} title={`Source ${chip}`} />}
        <span className="colorref__name">{name}</span>
        <span>{overridden ? 'hex' : `slot ${value.slot}`}</span>
      </div>
      <SlotStrip
        palette={palette}
        slot={overridden ? -1 : value.slot}
        onPick={(slot) => onChange({ ...value, slot, hex: null })}
      />
      <div className="field__row">
        <input
          type="color"
          className="stop__chip"
          value={resolved}
          aria-label={`${name} hex override`}
          onChange={(e) => onChange({ ...value, hex: e.target.value })}
        />
        <input
          className="text"
          type="text"
          value={value.hex ?? ''}
          placeholder={`${resolved} (from palette)`}
          aria-label={`${name} hex value`}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === '') return onChange({ ...value, hex: null })
            const hex = normalizeHex(raw)
            onChange({ ...value, hex: hex ?? raw })
          }}
        />
        {overridden && (
          <button
            type="button"
            className="btn btn--tiny"
            onClick={() => onChange({ ...value, hex: null })}
          >
            clear
          </button>
        )}
      </div>
      {showAlpha && (
        <Slider
          label="Alpha"
          value={alpha}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ ...value, alpha: v })}
        />
      )}
    </div>
  )
}
