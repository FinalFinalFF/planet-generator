import { useRef } from 'react'

/**
 * Click or drag on the photo to set the point that stays in view. Drawn from
 * the thumbnail when there is one — a library photo's full image may not be
 * loaded, and the picker never needs it.
 */
export function FocalPointPicker({
  src,
  width,
  height,
  focusX,
  focusY,
  maxHeight = 220,
  onChange,
}: {
  src: string
  width: number
  height: number
  focusX: number
  focusY: number
  maxHeight?: number
  onChange: (focusX: number, focusY: number) => void
}) {
  const dragging = useRef(false)
  const setFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    onChange(Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000)
  }
  return (
    <div
      className="focuspick"
      style={{
        aspectRatio: `${width} / ${height}`,
        width: `min(100%, ${Math.round((maxHeight * width) / height)}px)`,
      }}
      title="Click or drag to set the point that stays in view"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setFrom(e)
      }}
      onPointerMove={(e) => dragging.current && setFrom(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <img src={src} alt="" draggable={false} />
      <span className="focuspick__mark" style={{ left: `${focusX * 100}%`, top: `${focusY * 100}%` }} />
    </div>
  )
}
