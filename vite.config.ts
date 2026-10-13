import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
// @ts-expect-error — plain .mjs shared with orbgen and the Pages Function; no types
import { applyPrefsDiff, emptyPrefs, sanitizePrefs } from './tools/photo-library/prefs-merge.mjs'
import { join, normalize, sep } from 'node:path'

/**
 * Serve the local photo library (`photo-library/`, untracked client photos —
 * see tools/photo-library) at /photo-library in dev and preview. Deliberately
 * not part of the build: the public site must never carry it, and `dist/`
 * would otherwise grow by gigabytes. orbgen serves the same folder itself.
 */
function photoLibrary(): Plugin {
  const root = join(process.cwd(), 'photo-library')
  const mount = '/photo-library/'
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(mount)) return next()
    // Shared photo curation (favorites, hidden, framing): GET the prefs, POST
    // a diff — same protocol as orbgen and the hosted library's Pages
    // Function (tools/photo-library/prefs-merge.mjs). Backed by prefs.json.
    if (req.url.split('?')[0] === `${mount}prefs`) {
      const file = join(root, 'prefs.json')
      const read = () => {
        try {
          return sanitizePrefs(JSON.parse(readFileSync(file, 'utf8')))
        } catch {
          return emptyPrefs()
        }
      }
      const send = (body: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(body))
      }
      if (!existsSync(root)) {
        res.statusCode = 404
        return res.end()
      }
      if (req.method === 'GET') return send(read())
      if (req.method !== 'POST') {
        res.statusCode = 405
        return res.end()
      }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= 1024 * 1024) chunks.push(c)
      })
      req.on('end', () => {
        try {
          if (size > 1024 * 1024) throw new Error('too large')
          const next = applyPrefsDiff(read(), JSON.parse(Buffer.concat(chunks).toString('utf8')))
          const tmp = join(root, '.prefs.json.tmp')
          writeFileSync(tmp, JSON.stringify(next, null, 1))
          renameSync(tmp, file)
          send(next)
        } catch {
          res.statusCode = 400
          res.end()
        }
      })
      return
    }
    const rel = normalize(decodeURIComponent(req.url.slice(mount.length).split('?')[0]))
    const file = join(root, rel)
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'image/jpeg')
    res.setHeader('cache-control', 'max-age=3600')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'photo-library',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

export default defineConfig({
  // Served from the domain root of orbs.fnfn.us (custom domain on GitHub
  // Pages; see public/CNAME). A literal (not an env var) so `npm run preview`
  // exercises exactly what ships — dev matching prod is a rule here.
  //
  // Before the custom domain this was '/planet-generator/' — the GitHub repo
  // slug, under which Pages serves a project page. If the custom domain is
  // ever removed, that base must come back in the same change, or every asset
  // on the live site 404s.
  base: '/',
  plugins: [react(), photoLibrary()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    // api.html is the headless generation page tools/orbgen drives; it ships
    // alongside the editor so the deployed site can serve it too.
    rollupOptions: { input: { main: 'index.html', api: 'api.html' } },
  },
})
