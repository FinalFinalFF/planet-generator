/*
 * Orb Generator Bridge — places orbs that the local orbgen server
 * (tools/orbgen) hands to the UI. The UI does the networking (only it can
 * fetch); this side only touches the document.
 *
 * Each job becomes one frame at the viewport center holding a grid of orbs.
 * SVG orbs go through figma.createNodeFromSvg — the same importer as pasting
 * an SVG, so the export's layer names (`Sector_A1`, `Orb_clip`, …) carry over.
 */

figma.showUI(__html__, { width: 280, height: 132, title: 'Orb Generator Bridge' })

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== 'job') return
  const job = msg.job
  try {
    const result = await place(job)
    figma.ui.postMessage({ type: 'done', id: job.id, result })
    figma.notify(`Placed ${result.placed} orb${result.placed === 1 ? '' : 's'}`)
  } catch (err) {
    const error = (err && err.message) || String(err)
    figma.ui.postMessage({ type: 'done', id: job.id, error })
    figma.notify(`Orb placement failed: ${error}`, { error: true })
  }
}

async function place(job) {
  const orbs = job.orbs || []
  if (orbs.length === 0) throw new Error('Job has no orbs')
  const size = job.size || 400
  const gap = job.gap == null ? 40 : job.gap
  const cols = Math.max(1, Math.min(orbs.length, job.columns || Math.ceil(Math.sqrt(orbs.length))))
  const rows = Math.ceil(orbs.length / cols)

  const frame = figma.createFrame()
  frame.name = job.name || 'Orbs'
  frame.fills = []
  frame.clipsContent = false
  frame.resize(cols * size + (cols - 1) * gap, rows * size + (rows - 1) * gap)

  orbs.forEach((orb, i) => {
    let node
    if (orb.svg) {
      node = figma.createNodeFromSvg(orb.svg)
    } else {
      const image = figma.createImage(figma.base64Decode(orb.png))
      node = figma.createRectangle()
      node.resize(orb.width, orb.height)
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }]
    }
    node.name = orb.name
    frame.appendChild(node)
    const k = size / Math.max(orb.width || node.width, orb.height || node.height)
    if (Math.abs(k - 1) > 1e-6) node.rescale(k)
    node.x = (i % cols) * (size + gap)
    node.y = Math.floor(i / cols) * (size + gap)
  })

  const c = figma.viewport.center
  frame.x = Math.round(c.x - frame.width / 2)
  frame.y = Math.round(c.y - frame.height / 2)
  figma.currentPage.appendChild(frame)
  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([frame])
  return { placed: orbs.length, frameId: frame.id, frameName: frame.name, page: figma.currentPage.name }
}
