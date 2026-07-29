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
            title={lock.on ? 'Locked — Remix will not touch this' : 'Unlocked — Remix may change this'}
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
