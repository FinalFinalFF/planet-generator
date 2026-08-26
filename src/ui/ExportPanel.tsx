import { useState } from 'react'
import { Adv, Check, Field, NumberField, useTier } from './controls'

export type ExportPanelProps = {
  seed: string
  canvas: { width: number; height: number }
  busy: boolean
  /** Lifted to App so the E shortcut and the batch export use the same value. */
  transparent: boolean
  onTransparentChange: (v: boolean) => void
  /** True when the Background section's fill is set to none. */
  backgroundIsNone: boolean
  expandPatterns: boolean
  onExpandPatternsChange: (v: boolean) => void
  onExportSvg: (transparent: boolean) => void
  onExportPng: (longEdge: number, transparent: boolean) => void
  onCopySvg: (transparent: boolean) => void
  /** Clipboard copy with pattern tiles always expanded — the Figma paste path. */
  onCopyFigma: (transparent: boolean) => void
  motionEnabled: boolean
  /** Progress line while a video renders, or null. */
  videoProgress: string | null
  onExportVideo: (format: 'mp4' | 'webm', fps: number, longEdge: number) => void
}

const SCALES = [1, 2, 4]
const SIZES = [1024, 2048, 4096]

export function ExportPanel({
  seed,
  canvas,
  busy,
  transparent,
  onTransparentChange,
  backgroundIsNone,
  expandPatterns,
  onExpandPatternsChange,
  onExportSvg,
  onExportPng,
  onCopySvg,
  onCopyFigma,
  motionEnabled,
  videoProgress,
  onExportVideo,
}: ExportPanelProps) {
  const advanced = useTier() === 'advanced'
  const [custom, setCustom] = useState(3000)
  const [fps, setFps] = useState(30)
  const [videoEdge, setVideoEdge] = useState(1080)
  const longEdge = Math.max(canvas.width, canvas.height)

  const dims = (target: number) => {
    const f = target / longEdge
    return `${Math.round(canvas.width * f)}×${Math.round(canvas.height * f)}`
  }

  return (
    <>
      <Check
        label="Transparent background"
        checked={transparent || backgroundIsNone}
        onChange={onTransparentChange}
      />
      {backgroundIsNone && (
        <div className="note">
          Background fill is set to <strong>none</strong>, so SVG and PNG exports are already
          transparent whether or not this is ticked.
        </div>
      )}
      <Adv>
        <div className="note">
          Filenames use the seed: <strong>orb-{seed || 'seed'}.svg</strong>. This toggle also
          applies to the <kbd>E</kbd> shortcut and to batch exports.
        </div>

        <Check
          label="Expand pattern tiles"
          checked={expandPatterns}
          onChange={onExpandPatternsChange}
        />
        <div className="note">
          On, tiled patterns are written out as real geometry. Browsers render an SVG
          <code> &lt;pattern&gt;</code> fill fine, but design-tool importers commonly ignore it —
          Figma drops it, leaving the gradient with no texture. Off gives a much smaller file that
          is browser-only. PNG export never needs this.
        </div>
      </Adv>

      <hr className="divider" />
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={() => onCopyFigma(transparent)}
      >
        Copy for Figma
      </button>
      <div className="note">
        Copies the artwork as SVG — paste straight onto a Figma canvas (⌘V) as named,
        editable layers. Pattern tiles are always expanded here, since Figma drops
        SVG <code>&lt;pattern&gt;</code> fills.
      </div>
      <button
        type="button"
        className="btn btn--block"
        disabled={busy}
        onClick={() => onExportSvg(transparent)}
      >
        Download SVG
      </button>
      {/* Simple: one raster button, at 2× — a summary of the matrix, not a removal. */}
      {!advanced && (
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          title={dims(longEdge * 2)}
          onClick={() => onExportPng(longEdge * 2, transparent)}
        >
          Download PNG ({dims(longEdge * 2)})
        </button>
      )}
      {motionEnabled && (
        <>
          <hr className="divider" />
          <div className="eyebrow">Video — seamless loop</div>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => onExportVideo('mp4', fps, videoEdge)}
          >
            {videoProgress ?? 'Export MP4 loop'}
          </button>
          <div className="note">
            Renders every frame through the same pipeline as the PNG export, so the loop you
            watched is the loop you get. The encoder loads on first use (~25&nbsp;MB, once).
            Motion never reaches the SVG/Figma exports — those are the still at frame zero.
          </div>
          <Adv>
            <button
              type="button"
              className="btn btn--block"
              disabled={busy}
              onClick={() => onExportVideo('webm', fps, videoEdge)}
            >
              {videoProgress ?? 'Export WebM loop'}
            </button>
            <div className="grid2">
              <NumberField label="Frame rate" value={fps} min={12} max={60} onChange={setFps} />
              <NumberField label="Long edge px" value={videoEdge} min={240} max={2160} onChange={setVideoEdge} />
            </div>
          </Adv>
        </>
      )}
      <Adv>
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          onClick={() => onCopySvg(transparent)}
        >
          Copy SVG markup
        </button>

        <hr className="divider" />
        <div className="eyebrow">Raster — scale</div>
        <div className="grid3">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              disabled={busy}
              title={dims(longEdge * s)}
              onClick={() => onExportPng(longEdge * s, transparent)}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="note">
          1× = {dims(longEdge)} · 2× = {dims(longEdge * 2)} · 4× = {dims(longEdge * 4)}
        </div>

        <div className="eyebrow">Raster — long edge</div>
        <div className="grid3">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              disabled={busy}
              title={dims(s)}
              onClick={() => onExportPng(s, transparent)}
            >
              {s}
            </button>
          ))}
        </div>

        <NumberField label="Custom long edge px" value={custom} min={16} max={16384} onChange={setCustom} />
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          onClick={() => onExportPng(custom, transparent)}
        >
          Download PNG at {dims(custom)}
        </button>

        <hr className="divider" />
        <Field label="Notes">
          <div className="note">
            The exported SVG is a direct serialization of the live preview with all defs inlined, so it
            opens standalone in a browser. Conic sweeps are built from wedge geometry rather than a CSS
            conic gradient, so they survive export intact.
          </div>
        </Field>
      </Adv>
    </>
  )
}
