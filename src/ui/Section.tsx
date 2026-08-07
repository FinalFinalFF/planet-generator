import type { ReactNode } from 'react'
import type { LockSection } from '../types'

/**
 * Round-arrow icon. Drawn rather than set as a glyph: `⟳` renders as a faint
 * dot at this size in IBM Plex Mono, which reads as nothing at all.
 */
function RandomizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M13.4 1.6v3.6h-3.6z" fill="currentColor" />
    </svg>
  )
}

/**
 * A section lock freezes that section's *values*. Colors are palette-slot
 * references, so swapping the palette still recolors a locked section — that is
 * what the Palette (colors) lock is for. Saying so on the control itself is the
 * only place a user will look when a locked orb visibly changes color.
 */
function lockTitle(section: LockSection, on: boolean): string {
  if (section === 'colors') {
    return on
      ? 'Locked — the palette and every color assignment are frozen.'
      : 'Unlocked — Remix All may switch palette, and Shuffle colors may re-deal slots.'
  }
  return on
    ? 'Locked — settings and geometry here are frozen, including for Remix and ' +
        'Composition style. Colors still follow the palette; freeze those with the Palette lock.'
    : 'Unlocked — Remix and Composition style may change this section.'
}

export function Section({
  num,
  title,
  hint,
  open,
  onToggle,
  lock,
  randomize,
  children,
}: {
  num: string
  title: string
  hint?: string
  open: boolean
  onToggle: () => void
  /** When present, renders the section's remix lock next to the title. */
  lock?: { section: LockSection; on: boolean; onToggle: (on: boolean) => void }
  /** When present, renders a dice that randomizes only this section. */
  randomize?: { label: string; onRandomize: () => void; disabled?: boolean }
  children: ReactNode
}) {
  const diceDisabled = randomize?.disabled ?? false
  return (
    <section className="section">
      <button
        type="button"
        className="section__head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="section__num">{num}</span>
        <span className="section__title">{title}</span>
        {hint && <span className="section__hint">{hint}</span>}
        {randomize && (
          // A span, not a button: the section header is itself a button and
          // nesting one inside it is invalid.
          <span
            role="button"
            tabIndex={diceDisabled ? -1 : 0}
            className={`dice${diceDisabled ? ' dice--off' : ''}`}
            title={diceDisabled ? `Locked — unlock to randomize ${title}` : randomize.label}
            aria-label={randomize.label}
            aria-disabled={diceDisabled}
            onClick={(e) => {
              e.stopPropagation()
              if (!diceDisabled) randomize.onRandomize()
            }}
            onKeyDown={(e) => {
              if (!diceDisabled && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                randomize.onRandomize()
              }
            }}
          >
            <RandomizeIcon />
          </span>
        )}
        {lock && (
          <span
            role="button"
            tabIndex={0}
            className={`lock${lock.on ? ' lock--on' : ''}`}
            title={lockTitle(lock.section, lock.on)}
            aria-label={`${lock.on ? 'Unlock' : 'Lock'} ${title} for remix`}
            aria-pressed={lock.on}
            onClick={(e) => {
              e.stopPropagation()
              lock.onToggle(!lock.on)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                lock.onToggle(!lock.on)
              }
            }}
          >
            {lock.on ? 'LOCKED' : 'LOCK'}
          </span>
        )}
        <span className="section__chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="section__body">{children}</div>}
    </section>
  )
}
