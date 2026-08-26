/**
 * Shipped presets — the same pattern as `BUILTIN_PALETTES`: curated documents
 * baked into the build so every user sees them, marked `builtin` (loadable,
 * not deletable). One may carry `default: true`, and a brand-new visitor's
 * first document *is* that preset; returning visitors always get their own
 * persisted document instead.
 *
 * To add one: design in the app, use the header's export-presets action to
 * download the JSON, and paste the preset's object here (docs run through
 * `normalizeDoc` on load, so older shapes keep working).
 */

import type { OrbDoc, Preset } from '../types'
import { normalizeDoc } from './defaults'

export const BUILTIN_PRESETS: Preset[] = [
  {
    // Exported from staging 2026-08-25 (seed dusk-pulse-932) — the segments
    // collage on RSAC Main that seeds every new visitor's first document.
    id: 'builtin-rsac-collage',
    name: 'RSAC Collage',
    savedAt: 1787708763637,
    builtin: true,
    default: true,
    doc: {
      "version": 4,
      "seed": "dusk-pulse-932",
      "canvas": {
        "width": 1600,
        "height": 1600
      },
      "paletteId": "rsac-main",
      "orbType": "segments",
      "colorSource": "gradients",
      "background": {
        "kind": "solid",
        "color": {
          "slot": 0,
          "hex": "#000000"
        },
        "gradient": {
          "type": "linear",
          "angle": 180,
          "stops": [
            {
              "id": "rsac-spectrum-s0",
              "offset": 0,
              "color": {
                "slot": 0,
                "hex": "#B08ADA"
              }
            },
            {
              "id": "rsac-spectrum-s1",
              "offset": 1,
              "color": {
                "slot": 1,
                "hex": "#DB4750"
              }
            }
          ],
          "focusX": -0.021803019058424983,
          "focusY": 0.609298857487738,
          "radius": 1.0352175383828581,
          "segments": 200
        },
        "vignette": 0.1484590269625187
      },
      "orb": {
        "visible": true,
        "cx": 0.5,
        "cy": 0.5,
        "radius": 0.6040797596797347,
        "gradient": {
          "type": "linear",
          "angle": 180,
          "stops": [
            {
              "id": "rsac-convergence-s0",
              "offset": 0,
              "color": {
                "slot": 2,
                "hex": "#D893A8"
              }
            },
            {
              "id": "rsac-convergence-s1",
              "offset": 1,
              "color": {
                "slot": 0,
                "hex": "#00396C"
              }
            }
          ],
          "focusX": 0.3643832103163004,
          "focusY": 0.541272037178278,
          "radius": 0.5914608187275008,
          "segments": 240
        },
        "sectors": {
          "angle": 0,
          "offset": 0,
          "rowA": [
            {
              "kind": "texture",
              "patternId": "tx-rings-hairline",
              "colors": [
                {
                  "slot": 0,
                  "alpha": 1
                },
                {
                  "slot": 3,
                  "alpha": 1
                }
              ],
              "scale": 0.7766842182725667,
              "rotation": 0
            },
            {
              "kind": "ramp",
              "from": {
                "slot": 3,
                "hex": "#EA6F53"
              },
              "to": {
                "slot": 5,
                "hex": "#FFC505"
              },
              "angle": 180
            }
          ],
          "rowB": [
            {
              "kind": "flat",
              "color": {
                "slot": 4
              }
            }
          ]
        },
        "stroke": {
          "enabled": false,
          "width": 3.988480128813535,
          "color": {
            "slot": 5
          },
          "opacity": 0.5002053260104731
        }
      },
      "layers": [
        {
          "kind": "pattern",
          "id": "pl-default-a",
          "name": "Op Field",
          "visible": false,
          "patternId": "tx-wave-op-field",
          "fit": "tile",
          "mask": {
            "mode": "orb",
            "cx": 0.22,
            "cy": -0.18,
            "radius": 0.85,
            "feather": 0
          },
          "scale": 1.8037846493185499,
          "rotation": 0,
          "offsetX": 0.09529817132279278,
          "offsetY": -0.054815973993390804,
          "opacity": 0.6761130927386694,
          "blend": "normal",
          "colors": [
            {
              "slot": 0,
              "alpha": 0
            },
            {
              "slot": 4,
              "alpha": 1
            }
          ]
        },
        {
          "kind": "shading",
          "id": "sh-default",
          "name": "Sphere shading",
          "visible": false,
          "shadow": 0.8844075883738696,
          "highlight": 0.20282998671289532,
          "lightAngle": 17,
          "lightDistance": 0.4262432030029595,
          "highlightSize": 1.0924468423123472,
          "contactShadow": 0.5521105592139065,
          "shadowColor": {
            "slot": 0
          },
          "highlightColor": {
            "slot": 5
          },
          "blend": "normal",
          "opacity": 1
        },
        {
          "kind": "accent",
          "id": "ac-default",
          "name": "Accents",
          "visible": true,
          "rings": [
            {
              "id": "rme2j1cj",
              "radius": 1.4208424993092195,
              "start": 53,
              "sweep": 290,
              "width": 2.8865835641510786,
              "color": {
                "slot": 5
              },
              "opacity": 0.6106983546400443,
              "tilt": 1,
              "rotation": -8,
              "dash": 0
            },
            {
              "id": "rmnzr1g8",
              "radius": 1.1516738713951782,
              "start": 173,
              "sweep": 340,
              "width": 3.723639051942155,
              "color": {
                "slot": 5
              },
              "opacity": 0.49603406303795056,
              "tilt": 1,
              "rotation": 1,
              "dash": 7.382546689826995
            },
            {
              "id": "rmnzr1g9",
              "radius": 1.1254776702960954,
              "start": 332,
              "sweep": 140,
              "width": 2.8254529277794065,
              "color": {
                "slot": 5
              },
              "opacity": 0.36471054130233826,
              "tilt": 0.1872547590266913,
              "rotation": -18,
              "dash": 0
            }
          ],
          "satellites": [
            {
              "id": "samnzr1ga",
              "angle": 329,
              "distance": 1.596562219725456,
              "size": 0.08161799114546739,
              "color": {
                "slot": 5
              },
              "opacity": 0.7588977316976525,
              "strokeWidth": 0
            },
            {
              "id": "samnzr1gb",
              "angle": 139,
              "distance": 1.5223881484358572,
              "size": 0.07650606938404964,
              "color": {
                "slot": 5
              },
              "opacity": 0.6882422944065184,
              "strokeWidth": 0
            }
          ],
          "rim": {
            "enabled": false,
            "angle": 53,
            "width": 0.041669999431818726,
            "spread": 0.37920449678786095,
            "color": {
              "slot": 3
            },
            "opacity": 0.5450874186120928,
            "blend": "screen"
          }
        }
      ],
      "flat": false,
      "solidFills": false,
      "locks": {
        "colors": false,
        "orb": false,
        "patterns": false,
        "shading": false,
        "accents": false,
        "background": true
      },
      "subLocks": {
        "orb": {
          "type": true,
          "size": true,
          "position": true,
          "structure": false
        },
        "patterns": {
          "count": false
        },
        "colors": {
          "palette": true
        }
      }
    } as OrbDoc,
  },
]

/** The default-flagged builtin's document, normalized, or null if none. */
export function defaultPresetDoc(): OrbDoc | null {
  const preset = BUILTIN_PRESETS.find((p) => p.default)
  if (!preset) return null
  try {
    return normalizeDoc(structuredClone(preset.doc))
  } catch {
    return null
  }
}
