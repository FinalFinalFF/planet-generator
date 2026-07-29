import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clamp } from '../lib/color'

export function Stage({
  width,
  height,
  zoom,
  fit,
  onZoomChange,
  onFitChange,
  children,
}: {
  width: number
  height: number
  zoom: number
  fit: boolean
  onZoomChange: (z: number) => void
  onFitChange: (fit: boolean) => void
  children: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [fitZoom, setFitZoom] = useState(1)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const pad = 60
      const z = Math.min(
        (host.clientWidth - pad) / width,
        (host.clientHeight - pad) / height,
      )
      setFitZoom(clamp(z, 0.02, 4))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [width, height])

  const effective = fit ? fitZoom : zoom
  const shownW = Math.max(1, Math.round(width * effective))
  const shownH = Math.max(1, Math.round(height * effective))

  const setZoom = (z: number) => {
    onFitChange(false)
    onZoomChange(clamp(z, 0.05, 8))
  }

  return (
    <div className="stage" ref={hostRef}>
      <div className="stage__art" style={{ width: shownW, height: shownH }}>
        {children}
      </div>

      <div className="stage__hud">
        <button type="button" className="btn btn--icon" onClick={() => setZoom(effective / 1.25)} aria-label="Zoom out">
          −
        </button>
        <span className="stage__zoom">{Math.round(effective * 100)}%</span>
        <button type="button" className="btn btn--icon" onClick={() => setZoom(effective * 1.25)} aria-label="Zoom in">
          +
        </button>
        <button
          type="button"
          className={`btn btn--tiny${fit ? ' btn--active' : ''}`}
          onClick={() => onFitChange(!fit)}
        >
          FIT
        </button>
        <button type="button" className="btn btn--tiny" onClick={() => setZoom(1)}>
          100%
        </button>
      </div>

      <div className="stage__meta">
        {width} × {height}
      </div>
    </div>
  )
}
