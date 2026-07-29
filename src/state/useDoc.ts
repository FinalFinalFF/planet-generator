/** Document state with coalescing undo/redo and debounced persistence. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlanetDoc } from '../types'
import { saveDoc } from '../lib/storage'

const HISTORY_LIMIT = 80
const COALESCE_MS = 700

type History = {
  past: PlanetDoc[]
  present: PlanetDoc
  future: PlanetDoc[]
}

export type CommitOptions = {
  /**
   * Consecutive commits sharing a key inside the coalesce window collapse into
   * one history entry — dragging a slider should be one undo, not forty.
   */
  coalesce?: string
  /** Replace the present without touching history at all. */
  transient?: boolean
}

export type DocApi = {
  doc: PlanetDoc
  update: (recipe: (draft: PlanetDoc) => PlanetDoc, opts?: CommitOptions) => void
  replace: (next: PlanetDoc, opts?: CommitOptions) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  resetHistory: (next: PlanetDoc) => void
}

export function useDoc(initial: PlanetDoc): DocApi {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] })
  const lastCommit = useRef<{ key: string; at: number } | null>(null)

  /**
   * Decide whether this commit coalesces into the previous one, and record it.
   *
   * Deliberately **outside** the `setHistory` updater. StrictMode double-invokes
   * updaters to surface impurity, and writing `lastCommit` in there means the
   * second invocation reads back its own write — same key, 0 ms ago — and takes
   * the coalesce branch. The first commit of a slider drag would then never push
   * a history entry, so undo behaved differently in dev than in the production
   * build. Dev has to match prod, history included.
   */
  const beginCommit = useCallback((opts: CommitOptions): boolean => {
    if (opts.transient) return false
    const now = Date.now()
    const prev = lastCommit.current
    const coalesce =
      opts.coalesce != null && prev?.key === opts.coalesce && now - prev.at < COALESCE_MS
    lastCommit.current = opts.coalesce != null ? { key: opts.coalesce, at: now } : null
    return coalesce
  }, [])

  const replace = useCallback(
    (next: PlanetDoc, opts: CommitOptions = {}) => {
      // Committed before the updater runs, so a `next === h.present` no-op below
      // still refreshes the coalesce window. Harmless: a commit that changes
      // nothing has nothing to undo.
      const coalesce = beginCommit(opts)
      setHistory((h) => {
        if (next === h.present) return h
        if (opts.transient) return { ...h, present: next }
        if (coalesce) return { past: h.past, present: next, future: [] }
        return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
      })
    },
    [beginCommit],
  )

  const update = useCallback(
    (recipe: (draft: PlanetDoc) => PlanetDoc, opts: CommitOptions = {}) => {
      const coalesce = beginCommit(opts)
      setHistory((h) => {
        // The recipe stays inside the updater: it is pure and needs fresh state.
        const next = recipe(h.present)
        if (next === h.present) return h
        if (opts.transient) return { ...h, present: next }
        if (coalesce) return { past: h.past, present: next, future: [] }
        return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
      })
    },
    [beginCommit],
  )

  const undo = useCallback(() => {
    lastCommit.current = null
    setHistory((h) => {
      if (h.past.length === 0) return h
      const present = h.past[h.past.length - 1]
      return {
        past: h.past.slice(0, -1),
        present,
        future: [h.present, ...h.future].slice(0, HISTORY_LIMIT),
      }
    })
  }, [])

  const redo = useCallback(() => {
    lastCommit.current = null
    setHistory((h) => {
      if (h.future.length === 0) return h
      const [present, ...rest] = h.future
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present, future: rest }
    })
  }, [])

  const resetHistory = useCallback((next: PlanetDoc) => {
    lastCommit.current = null
    setHistory({ past: [], present: next, future: [] })
  }, [])

  // Persist, but not on every slider frame.
  useEffect(() => {
    const t = setTimeout(() => saveDoc(history.present), 350)
    return () => clearTimeout(t)
  }, [history.present])

  return useMemo(
    () => ({
      doc: history.present,
      update,
      replace,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      resetHistory,
    }),
    [history, update, replace, undo, redo, resetHistory],
  )
}
