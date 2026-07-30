/**
 * @vitest-environment jsdom
 *
 * Pattern parse output. Needs DOMParser/XMLSerializer, hence jsdom — this is the
 * only file that pays for it.
 *
 * The snapshot guards the shape as a whole; the explicit assertions below it
 * guard the contracts that actually matter, so a careless `vitest -u` cannot
 * quietly bless a regression in them.
 */

import { describe, expect, it } from 'vitest'
import { parsePatternSvg } from './parse'

/**
 * Covers, in one fixture: a full-bleed background rect, a gradient def whose
 * stop-color must be tokenized, a mask subtree whose colors must NOT be, an id
 * that must be rewritten to the %%ns%% placeholder, and a style="fill:…".
 */
const FIXTURE = `<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0" y1="0" x2="200" y2="0">
      <stop stop-color="#e63946"/>
      <stop offset="1" stop-color="#1d3557"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="#ffffff"/>
  <mask id="m1" style="mask-type:luminance">
    <rect width="200" height="200" fill="white"/>
    <circle cx="100" cy="100" r="60" fill="black"/>
  </mask>
  <g mask="url(#m1)">
    <path d="M0 0H100V100H0V0Z" fill="url(#grad1)"/>
    <circle cx="150" cy="150" r="25" fill="#278576"/>
    <rect x="10" y="10" width="20" height="20" style="fill:#a8dadc"/>
  </g>
</svg>`

const parsed = parsePatternSvg('fixture', 'Fixture', FIXTURE)

describe('parsePatternSvg', () => {
  it('matches the recorded shape', () => {
    expect({ template: parsed.template, groups: parsed.groups }).toMatchSnapshot()
  })

  it('reads the tile box from the viewBox', () => {
    expect([parsed.width, parsed.height]).toEqual([200, 200])
  })

  it('detects the full-bleed rect as the background plate', () => {
    const plate = parsed.groups.find((g) => g.isBackground)
    expect(plate).toBeDefined()
    expect(plate?.sample).toBe('#ffffff')
  })

  it('tokenizes gradient stop colors', () => {
    expect(parsed.tokenColors).toContain('#e63946')
    expect(parsed.tokenColors).toContain('#1d3557')
    expect(parsed.template).toMatch(/<stop[^>]*stop-color="%%c\d+%%"/)
  })

  it('tokenizes colors set through a style attribute', () => {
    expect(parsed.tokenColors).toContain('#a8dadc')
    expect(parsed.template).toMatch(/style="fill:%%c\d+%%"/)
  })

  /*
   * The mask's white/black are structural: recoloring them destroys the mask,
   * because it is luminance-based.
   */
  it('leaves colors inside a <mask> subtree alone', () => {
    const maskBlock = parsed.template.slice(
      parsed.template.indexOf('<mask'),
      parsed.template.indexOf('</mask>'),
    )
    expect(maskBlock).toContain('fill="white"')
    expect(maskBlock).toContain('fill="black"')
    expect(maskBlock).not.toMatch(/%%c\d+%%/)
  })

  it('rewrites every internal id to the %%ns%% placeholder', () => {
    expect(parsed.template).toContain('id="%%ns%%-grad1"')
    expect(parsed.template).toContain('id="%%ns%%-m1"')
    expect(parsed.template).toContain('url(#%%ns%%-grad1)')
    expect(parsed.template).toContain('url(#%%ns%%-m1)')
    // No bare original ids survive.
    expect(parsed.template).not.toMatch(/\bid="(grad1|m1)"/)
  })

  it('clusters colors into assignable groups, plate first', () => {
    expect(parsed.groups[0].isBackground).toBe(true)
    expect(parsed.groups.length).toBeGreaterThan(1)
    expect(parsed.groups.length).toBeLessThanOrEqual(8)
    // Every token belongs to exactly one group.
    const claimed = parsed.groups.flatMap((g) => g.tokens).sort((a, b) => a - b)
    expect(claimed).toEqual(parsed.tokenColors.map((_, i) => i))
  })

  it('strips executable and externally-referencing markup', () => {
    // `#keep` needs a real target: namespacing only rewrites references to ids
    // that exist in the template, so a dangling fragment stays as written.
    const hostile = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" onload="x=1">
      <script>x=2</script>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
      <defs><linearGradient id="keep"><stop stop-color="#123456"/></linearGradient></defs>
      <circle cx="5" cy="5" r="4" fill="black" onclick="x=3"/>
      <use href="https://evil.example/a.svg#p"/>
      <rect width="4" height="4" fill="url(#keep)"/>
    </svg>`
    const out = parsePatternSvg('hostile', 'Hostile', hostile).template
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/<foreignobject/i)
    expect(out).not.toMatch(/\son[a-z]+=/i)
    expect(out).not.toContain('evil.example')
    // The legitimate same-document reference survives, and is namespaced.
    expect(out).toContain('id="%%ns%%-keep"')
    expect(out).toContain('url(#%%ns%%-keep)')
  })

  it('treats fully transparent literals as not-a-color', () => {
    const svg = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
      <rect width="10" height="10" fill="#ffffff"/>
      <circle cx="2" cy="2" r="1" fill="transparent"/>
      <circle cx="5" cy="5" r="1" fill="#11223300"/>
      <circle cx="8" cy="8" r="1" fill="black"/>
    </svg>`
    const out = parsePatternSvg('tr', 'Transparent', svg)
    expect(out.tokenColors.sort()).toEqual(['#000000', '#ffffff'])
    expect(out.template).toContain('fill="transparent"')
    expect(out.template).toContain('fill="#11223300"')
  })
})
