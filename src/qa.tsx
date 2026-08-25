/**
 * TEMPORARY QA route — a contact sheet of sector-mode variants.
 * Delete this file and qa.html before finishing (CLAUDE.md).
 */

import { createRoot } from 'react-dom/client'
import { OrbSvg } from './render/OrbSvg'
import { defaultDoc } from './lib/defaults'
import { BUILTIN_PALETTES } from './lib/palettes'
import type { ColorRef, OrbDoc, SectorConfig, SectorFill } from './types'
import type { ParsedPattern } from './lib/patterns/parse'

const parsedById = new Map<string, ParsedPattern>()

const flat = (slot: number, alpha = 1): SectorFill => ({
  kind: 'flat',
  color: alpha === 1 ? { slot } : ({ slot, alpha } as ColorRef),
})
const ramp = (from: number, to: number, angle: number): SectorFill => ({
  kind: 'ramp',
  from: { slot: from },
  to: { slot: to },
  angle,
})

function sectorDoc(paletteIdx: number, sectors: SectorConfig, stroke = false): OrbDoc {
  const doc = defaultDoc('qa')
  const palette = BUILTIN_PALETTES[paletteIdx % BUILTIN_PALETTES.length]
  return {
    ...doc,
    paletteId: palette.id,
    flat: true,
    layers: [],
    canvas: { width: 600, height: 600 },
    background: { ...doc.background, kind: 'solid', color: { slot: 0 }, vignette: 0 },
    orb: {
      ...doc.orb,
      mode: 'sectors',
      cx: 0.5,
      cy: 0.5,
      radius: 0.82,
      sectors,
      stroke: { ...doc.orb.stroke, enabled: stroke, width: 3 },
    },
  }
}

type Variant = { label: string; doc: OrbDoc }

const variants: Variant[] = [
  {
    label: 'halves · flat/flat · 0°',
    doc: sectorDoc(0, { angle: 0, offset: 0, rowA: [flat(6)], rowB: [flat(1)] }),
  },
  {
    label: 'comp: ramp top, 2-cell bottom',
    doc: sectorDoc(1, {
      angle: 0,
      offset: 0,
      rowA: [ramp(4, 7, 64)],
      rowB: [flat(0), flat(3)],
    }),
  },
  {
    label: 'quadrants · 2+2 · 0°',
    doc: sectorDoc(2, {
      angle: 0,
      offset: 0,
      rowA: [flat(0), flat(5)],
      rowB: [flat(6), flat(2)],
    }),
  },
  {
    label: '1+2 · vertical chord (90°)',
    doc: sectorDoc(3, {
      angle: 90,
      offset: 0,
      rowA: [flat(2)],
      rowB: [ramp(3, 6, 0), flat(0)],
    }),
  },
  {
    label: '2+3 · offset −0.3',
    doc: sectorDoc(4, {
      angle: 0,
      offset: -0.3,
      rowA: [flat(5), flat(1)],
      rowB: [flat(0), ramp(2, 6, 90), flat(4)],
    }),
  },
  {
    label: 'halves · ramps · 30°',
    doc: sectorDoc(5, {
      angle: 30,
      offset: 0,
      rowA: [ramp(5, 7, 120)],
      rowB: [ramp(0, 3, 300)],
    }),
  },
  {
    label: '3+3 · 0°',
    doc: sectorDoc(6, {
      angle: 0,
      offset: 0.12,
      rowA: [flat(1), flat(6), flat(3)],
      rowB: [flat(5), flat(0), flat(2)],
    }),
  },
  {
    label: 'thin base · offset 0.55',
    doc: sectorDoc(7, {
      angle: 0,
      offset: 0.55,
      rowA: [ramp(3, 7, 45)],
      rowB: [flat(0)],
    }),
  },
  {
    label: '2+2 · 45° · mixed',
    doc: sectorDoc(8, {
      angle: 45,
      offset: 0,
      rowA: [flat(6), ramp(1, 4, 45)],
      rowB: [ramp(5, 7, 225), flat(0)],
    }),
  },
  {
    label: '1+3 · offset −0.2',
    doc: sectorDoc(9, {
      angle: 0,
      offset: -0.2,
      rowA: [flat(7)],
      rowB: [flat(0), flat(4), flat(2)],
    }),
  },
  {
    label: '2+1 · 120°',
    doc: sectorDoc(10, {
      angle: 120,
      offset: 0.1,
      rowA: [flat(2), flat(5)],
      rowB: [ramp(0, 6, 200)],
    }),
  },
  {
    label: 'default config · outline',
    doc: sectorDoc(11, {
      angle: 0,
      offset: 0,
      rowA: [ramp(5, 7, 64)],
      rowB: [flat(0), flat(3)],
    }, true),
  },
]

function Sheet() {
  return (
    <>
      {variants.map((v, i) => (
        <figure key={i}>
          <OrbSvg
            doc={v.doc}
            palette={
              BUILTIN_PALETTES.find((p) => p.id === v.doc.paletteId) ?? BUILTIN_PALETTES[0]
            }
            parsedById={parsedById}
            idPrefix={`qa${i}`}
          />
          <figcaption>{v.label}</figcaption>
        </figure>
      ))}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Sheet />)
