/** Small, uniform control primitives. Every continuous value gets both a
 *  slider and a numeric input, per the brief — in both tiers, deliberately:
 *  typed exact values are how a brand team matches spec across a series, and
 *  dropping the numeric in Simple would make the tiers lay out differently. */

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { clamp, normalizeHex } from '../lib/color'
import { refAlpha, resolveColor } from '../lib/palettes'
import type { ColorRef, Palette } from '../types'

/* ---------- the Simple / Advanced tier ---------- */

export type Tier = 'simple' | 'advanced'

/**
 * One global tier, not per-section: depth need is a property of the person and
 * session, not of a section. Mode-dependence hides what is *irrelevant*; this
 * hides what is *deep*. Defaulting to `advanced` here is deliberate — anything
 * rendered outside the provider (tests, stray composition) shows everything
 * rather than silently hiding controls.
 */
export const TierContext = createContext<Tier>('advanced')

export const useTier = (): Tier => useContext(TierContext)

/** Renders its children in the Advanced tier only. Interleave in place —
 *  advanced controls belong where their siblings are, not in a ghetto. */
export function Adv({ children }: { children: ReactNode }) {
  return useTier() === 'advanced' ? <>{children}</> : null
}

export function Field({
  label,
  hint,
  tools,
  children,
}: {
  label: string
  hint?: ReactNode
  /** Right-aligned adornments on the label row — property padlocks live here. */
  tools?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        <span className="field__tools">
          {hint != null && <span>{hint}</span>}
          {tools}
        </span>
      </div>
      {children}
    </div>
  )
}

/**
 * The 11px drawn padlock that guards one property. Drawn rather than a glyph
 * for the same reason as the dice: font glyphs die at this size. Off: outline,
 * muted. On: filled accent. `implied` renders filled-but-dimmed — covered by a
 * parent lock (section lock, or existence implication) rather than its own
 * state, and still clickable to set its own state.
 */
export function PropLock({
  on,
  implied = false,
  title,
  onToggle,
}: {
  on: boolean
  implied?: boolean
  title: string
  onToggle: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`proplock${on ? ' proplock--on' : ''}${implied && !on ? ' proplock--implied' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(!on)
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect x="3" y="7" width="10" height="7" rx="0" fill={on || implied ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  )
}

/**
 * Wrapper that makes a group of controls inert.
 *
 * A `<fieldset disabled>` rather than `pointer-events: none`, because that only
 * stops the mouse — the controls would still take keyboard focus and still be
 * changeable. `disabled` on a fieldset genuinely disables every form control
 * inside it. The reset styles are needed because a bare fieldset brings its own
 * border, padding and min-width, which would break the field layout.
 */
export function Inert({
  disabled,
  children,
}: {
  disabled: boolean
  children: ReactNode
}) {
  return (
    <fieldset className="inert" disabled={disabled}>
      {children}
    </fieldset>
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
  tools,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  suffix?: string
  tools?: ReactNode
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
        <span className="field__tools">
          {suffix != null && <span>{suffix}</span>}
          {tools}
        </span>
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
  tools,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  tools?: ReactNode
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
        {tools != null && <span className="field__tools">{tools}</span>}
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
  tools,
  onChange,
}: {
  label?: string
  value: T
  options: readonly { value: T; label: string }[]
  tools?: ReactNode
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
  return label ? (
    <Field label={label} tools={tools}>
      {body}
    </Field>
  ) : (
    body
  )
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
  // The one primitive-level tier rule that simplifies ~20 call sites at once:
  // Simple shows name + slot strip only; the hex override and alpha are the
  // expert path, which also protects the slot indirection the color system is
  // built on. An active override still shows in Simple ("hex" in the header),
  // so hidden state that changes pixels is never invisible.
  const advanced = useTier() === 'advanced'
  const resolved = resolveColor(value, palette)
  const alpha = refAlpha(value)
  const overridden = !!value.hex
  // A fully transparent ink (pattern plates ship at alpha 0 on purpose) makes
  // the slot strip look broken in Simple, where the Alpha slider is hidden —
  // picking a color changes nothing on canvas. Hidden state that changes
  // pixels must never be invisible, so say so and offer the one-tap fix.
  const hidden = showAlpha && alpha <= 0.001

  return (
    <div className="colorref">
      <div className="colorref__head">
        {chip && <span className="colorref__chip" style={{ background: chip }} title={`Source ${chip}`} />}
        <span className="colorref__name">{name}</span>
        <span>{hidden ? 'hidden · alpha 0' : overridden ? 'hex' : `slot ${value.slot}`}</span>
      </div>
      <SlotStrip
        palette={palette}
        slot={overridden ? -1 : value.slot}
        onPick={(slot) => onChange({ ...value, slot, hex: null })}
      />
      {hidden && !advanced && (
        <div className="field__row">
          <span className="note" style={{ flex: 1 }}>
            This ink is fully transparent, so color picks don't show.
          </span>
          <button
            type="button"
            className="btn btn--tiny"
            onClick={() => onChange({ ...value, alpha: 1 })}
          >
            show
          </button>
        </div>
      )}
      {advanced && (
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
      )}
      {advanced && showAlpha && (
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
