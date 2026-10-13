/**
 * The orbgen service: generation (via headless Chrome on the app's api.html),
 * file output, and the Figma bridge — exposed over a local HTTP API.
 *
 * One process owns the port (default 7331). `server.mjs` runs it standalone;
 * `mcp.mjs` runs it in-process, or — when another orbgen already holds the
 * port — talks to that one over HTTP (`connect()`), so the Figma plugin only
 * ever needs one address.
 *
 * HTTP API (JSON in, JSON out; localhost only):
 *   GET  /v1/health                → { orbgen: true, version }
 *   GET  /v1/options               → palettes, presets, patterns, orb types
 *   POST /v1/generate              → body: GenerateRequest (+ photoPath, outputDir, write)
 *   POST /v1/figma/place           → body: GenerateRequest (+ photoPath, layout, as)
 *   GET  /v1/figma/status          → is the Figma plugin connected?
 *   GET  /v1/library?search=&tag=&selects=1&limit=  → search the photo library
 *   GET  /photo-library/*          → the local photo library (catalog, thumbs, full)
 *   GET  /v1/bridge/next?wait=25   → (plugin) long-poll for the next placement job
 *   POST /v1/bridge/result/:id     → (plugin) report a job's outcome
 *   GET  /*                        → the built app (dist/), incl. /api.html
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Renderer } from './chrome.mjs'

export const VERSION = '0.1.0'
export const DEFAULT_PORT = Number(process.env.ORBGEN_PORT) || 7331

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const DIST = join(REPO, 'dist')
// Local client photo library (untracked; tools/photo-library/build.swift).
const PHOTO_LIBRARY = join(REPO, 'photo-library')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const safeFilePart = (s) =>
  (s || 'orb').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^-|-$)/g, '')

/** Resolve a photo given as a file path or http(s) URL into a data URL. */
async function photoDataUrl(source) {
  if (/^data:image\//.test(source)) return source
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Could not fetch photo ${source}: HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  }
  const path = source.startsWith('~') ? join(homedir(), source.slice(1)) : resolve(source)
  const ext = extname(path).toLowerCase()
  if (ext === '.heic' || ext === '.heif') {
    throw new Error(`${path}: HEIC is not decodable in Chrome — export it as JPEG first`)
  }
  const type = MIME[ext]?.startsWith('image/') ? MIME[ext] : 'image/jpeg'
  const bytes = await readFile(path)
  return `data:${type};base64,${bytes.toString('base64')}`
}

/**
 * Turn the transport-level extras into the page's GenerateRequest: photos
 * given as a file `path` or `url` are read here and sent as data URLs; library
 * photos (`id`) and data URLs pass through. `photoPath`/`photoUrl` are the
 * single-photo shorthand.
 */
async function toPageRequest(body) {
  const { photoPath, photoUrl, outputDir: _o, write: _w, layout: _l, as: _a, ...req } = body ?? {}
  const nameOf = (src) => String(src).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')
  const resolvePhoto = async (spec) => {
    const { path, url, ...rest } = spec ?? {}
    const src = path ?? url
    if (!src) return rest
    return { ...rest, dataUrl: await photoDataUrl(src), name: rest.name ?? nameOf(src) }
  }
  const shorthand = photoPath ?? photoUrl
  if (shorthand) req.photo = { ...(req.photo ?? {}), path: shorthand }
  if (req.photo) req.photo = await resolvePhoto(req.photo)
  if (req.photos) req.photos = await Promise.all(req.photos.map(resolvePhoto))
  return req
}

export class Orbgen {
  constructor({ port = DEFAULT_PORT } = {}) {
    this.port = port
    const appUrl = process.env.ORBGEN_APP_URL?.replace(/\/$/, '')
    this.pageUrl = appUrl ? `${appUrl}/api.html` : `http://127.0.0.1:${port}/api.html`
    this.servesDist = !appUrl
    this.renderer = new Renderer(this.pageUrl)
    this.jobs = [] // queued placement jobs
    this.waiters = [] // plugin long-polls waiting for a job
    this.inflight = new Map() // job id → { resolve, reject, timer }
    this.lastPluginSeen = 0
    this.nextJob = 0
  }

  #checkDist() {
    if (this.servesDist && !existsSync(join(DIST, 'api.html'))) {
      throw new Error(
        `No built app at ${DIST}. Run \`npm run build\` in ${REPO}, ` +
          'or set ORBGEN_APP_URL=http://localhost:5173 to render from the dev server.',
      )
    }
  }

  async options() {
    this.#checkDist()
    return this.renderer.call('options')
  }

  /**
   * Generate orbs. With `write` (default true) files land in `outputDir`
   * (default ~/Downloads/orbgen/<seed>) and the result lists paths instead of
   * carrying the markup.
   */
  async generate(body = {}) {
    this.#checkDist()
    const req = await toPageRequest(body)
    const result = await this.renderer.call('generate', req)
    if (body.write === false) return result

    const dir = resolve(
      (body.outputDir ?? join(homedir(), 'Downloads', 'orbgen', safeFilePart(result.seed))).replace(
        /^~(?=$|\/)/,
        homedir(),
      ),
    )
    await mkdir(dir, { recursive: true })
    const orbs = []
    for (const orb of result.orbs) {
      const files = {}
      const stem = `orb-${safeFilePart(orb.seed)}`
      if (orb.svg) {
        files.svg = join(dir, `${stem}.svg`)
        await writeFile(files.svg, orb.svg)
      }
      if (orb.png) {
        files.png = join(dir, `${stem}-${req.pngSize ?? 2048}.png`)
        await writeFile(files.png, Buffer.from(orb.png, 'base64'))
      }
      if (orb.doc) {
        files.doc = join(dir, `${stem}.json`)
        await writeFile(files.doc, JSON.stringify(orb.doc, null, 2))
      }
      const { svg: _s, png: _p, doc: _d, ...meta } = orb
      orbs.push({ ...meta, files })
    }
    // Enough to reproduce the run: the request (minus the photo bytes — the
    // caller's paths and library ids are recorded instead) and seeds.
    const strip = (p) => (p ? { ...p, dataUrl: undefined } : p)
    const sourced = (p, i) => ({ ...strip(p), source: body.photos?.[i]?.path ?? body.photos?.[i]?.url })
    await writeFile(
      join(dir, 'orbgen-run.json'),
      JSON.stringify(
        {
          request: {
            ...req,
            photo: req.photo && { ...strip(req.photo), source: body.photoPath ?? body.photoUrl ?? body.photo?.path },
            photos: req.photos?.map(sourced),
          },
          seed: result.seed,
          orbs,
          notes: result.notes,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    return { seed: result.seed, outputDir: dir, orbs, notes: result.notes }
  }

  figmaStatus() {
    const ago = this.lastPluginSeen ? Date.now() - this.lastPluginSeen : null
    return {
      // Connected = a long-poll is open right now, or one just ended (the
      // plugin re-polls immediately). "Polled within the last N seconds"
      // reported a closed plugin as connected for most of a poll window.
      connected: this.waiters.length > 0 || (ago !== null && ago < 5000),
      lastSeenMsAgo: ago,
      queued: this.jobs.length,
      inflight: this.inflight.size,
    }
  }

  /**
   * Generate, then hand the orbs to the Figma plugin and wait for it to place
   * them. `layout`: { name, columns, size (px per orb in Figma), gap }.
   * `as`: 'svg' (editable vectors, default) or 'png' (image fills).
   */
  async placeInFigma(body = {}) {
    const as = body.as === 'png' ? 'png' : 'svg'
    const timeoutMs = Math.max(5000, Math.min(600000, body.timeoutMs ?? 120000))
    if (!this.figmaStatus().connected) {
      throw new Error(
        'The Figma plugin is not connected. In Figma desktop: Plugins → Development → ' +
          '"Orb Generator Bridge" (import tools/orbgen/figma-plugin/manifest.json once), and leave it open.',
      )
    }
    const generated = await this.generate({
      ...body,
      format: as,
      write: false,
    })
    const layout = body.layout ?? {}
    const job = {
      id: `job-${++this.nextJob}-${Date.now().toString(36)}`,
      name: layout.name ?? `Orbs ${generated.seed}`,
      columns: layout.columns,
      size: layout.size ?? 400,
      gap: layout.gap ?? 40,
      orbs: generated.orbs.map((o) => ({
        name: o.name,
        width: o.width,
        height: o.height,
        ...(as === 'svg' ? { svg: o.svg } : { png: o.png }),
      })),
    }
    const outcome = new Promise((resolveJob, rejectJob) => {
      const timer = setTimeout(() => {
        this.inflight.delete(job.id)
        this.jobs = this.jobs.filter((j) => j.id !== job.id)
        rejectJob(new Error(`Figma did not confirm placement within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.inflight.set(job.id, { resolve: resolveJob, reject: rejectJob, timer })
    })
    this.#enqueue(job)
    const placed = await outcome
    return {
      seed: generated.seed,
      placed,
      orbs: generated.orbs.map(({ svg: _s, png: _p, doc: _d, ...meta }) => meta),
      notes: generated.notes,
    }
  }

  #enqueue(job) {
    const waiter = this.waiters.shift()
    if (waiter) waiter(job)
    else this.jobs.push(job)
  }

  /**
   * Plugin long-poll: resolves with a job, or null after `waitMs`. `onClose`
   * registers a hook for the request closing early (plugin window closed):
   * the waiter is withdrawn so no job is handed to a dead connection.
   */
  nextBridgeJob(waitMs, onClose) {
    this.lastPluginSeen = Date.now()
    const job = this.jobs.shift()
    if (job) return Promise.resolve(job)
    return new Promise((res) => {
      const withdraw = () => {
        clearTimeout(timer)
        this.waiters = this.waiters.filter((w) => w !== waiter)
      }
      const waiter = (j) => {
        withdraw()
        res(j)
      }
      const timer = setTimeout(() => {
        withdraw()
        this.lastPluginSeen = Date.now()
        res(null)
      }, waitMs)
      this.waiters.push(waiter)
      onClose?.(() => {
        withdraw()
        res(null)
      })
    })
  }

  bridgeResult(id, payload) {
    this.lastPluginSeen = Date.now()
    const p = this.inflight.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.inflight.delete(id)
    if (payload?.error) p.reject(new Error(`Figma: ${payload.error}`))
    else p.resolve(payload?.result ?? payload)
    return true
  }

  /** Serve the HTTP API. Resolves once listening; rejects with EADDRINUSE. */
  listen() {
    const server = createServer((req, res) => this.#handle(req, res))
    // Generation of large batches can take a while; never cut a response off.
    server.requestTimeout = 0
    server.headersTimeout = 0
    return new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(this.port, '127.0.0.1', () => {
        server.off('error', rejectListen)
        this.server = server
        resolveListen(server)
      })
    })
  }

  async #handle(req, res) {
    // The Figma plugin UI runs on an opaque origin ("null"); everything else
    // is local tooling. Bound to 127.0.0.1, so CORS * exposes nothing remote.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()

    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const readBody = async () => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const text = Buffer.concat(chunks).toString('utf8')
      return text ? JSON.parse(text) : {}
    }

    try {
      if (url.pathname === '/v1/health') return json(200, { orbgen: true, version: VERSION })
      if (url.pathname === '/v1/options' && req.method === 'GET') return json(200, await this.options())
      if (url.pathname === '/v1/generate' && req.method === 'POST') {
        return json(200, await this.generate(await readBody()))
      }
      if (url.pathname === '/v1/figma/place' && req.method === 'POST') {
        return json(200, await this.placeInFigma(await readBody()))
      }
      if (url.pathname === '/v1/figma/status') return json(200, this.figmaStatus())
      if (url.pathname === '/v1/library' && req.method === 'GET') {
        return json(
          200,
          await this.libraryPhotos({
            search: url.searchParams.get('search') ?? undefined,
            tags: url.searchParams.getAll('tag'),
            selectsOnly: url.searchParams.get('selects') === '1',
            favoritesOnly: url.searchParams.get('favorites') === '1',
            limit: Number(url.searchParams.get('limit') ?? 50),
          }),
        )
      }
      if (url.pathname === '/v1/bridge/next' && req.method === 'GET') {
        const wait = Math.max(0, Math.min(30, Number(url.searchParams.get('wait') ?? 25))) * 1000
        const job = await this.nextBridgeJob(wait, (gone) =>
          res.on('close', () => !res.writableFinished && gone()),
        )
        if (!job) return void (res.destroyed || res.writeHead(204).end())
        if (res.destroyed) {
          this.jobs.unshift(job) // the plugin left mid-handoff; keep it for the next poll
          return
        }
        return json(200, job)
      }
      const m = /^\/v1\/bridge\/result\/([\w-]+)$/.exec(url.pathname)
      if (m && req.method === 'POST') return json(200, { ok: this.bridgeResult(m[1], await readBody()) })
      if (url.pathname.startsWith('/v1/')) return json(404, { error: `No route ${req.method} ${url.pathname}` })
      if (url.pathname === '/photo-library/prefs.json' && req.method === 'PUT') {
        // The editor saves app-level photo prefs here (favorites, hidden,
        // site-wide framing); the library tools and api.html read them back.
        if (!existsSync(PHOTO_LIBRARY)) return json(400, { error: 'No photo library' })
        const body = await readBody()
        const tmp = join(PHOTO_LIBRARY, '.prefs.json.tmp')
        await writeFile(tmp, JSON.stringify(body, null, 1))
        await rename(tmp, join(PHOTO_LIBRARY, 'prefs.json'))
        return void res.writeHead(204).end()
      }
      if (url.pathname.startsWith('/photo-library/')) {
        return this.#serveFile(PHOTO_LIBRARY, url.pathname.slice('/photo-library'.length), res)
      }
      return this.#serveStatic(url.pathname, res)
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  async #serveStatic(pathname, res) {
    if (!this.servesDist) return void res.writeHead(404).end()
    return this.#serveFile(DIST, pathname === '/' ? '/index.html' : pathname, res)
  }

  async #serveFile(root, pathname, res) {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(root, rel)
    if (!file.startsWith(root + sep) || !existsSync(file)) return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  }

  /** Search the local photo library's catalog (no browser needed). */
  async libraryPhotos({ search, tags, selectsOnly = false, favoritesOnly = false, limit = 50 } = {}) {
    const file = join(PHOTO_LIBRARY, 'catalog.json')
    if (!existsSync(file)) return { total: 0, photos: [], note: 'No photo library built (tools/photo-library).' }
    const { photos } = JSON.parse(await readFile(file, 'utf8'))
    const prefsFile = join(PHOTO_LIBRARY, 'prefs.json')
    const prefs = existsSync(prefsFile) ? JSON.parse(await readFile(prefsFile, 'utf8')) : {}
    const favorites = new Set(prefs.favorites ?? [])
    const hidden = new Set(prefs.hidden ?? [])
    const q = search?.trim().toLowerCase()
    const hits = photos.filter(
      (p) =>
        !hidden.has(`lib:${p.id}`) &&
        (!favoritesOnly || favorites.has(`lib:${p.id}`)) &&
        (!selectsOnly || p.selects) &&
        (!tags?.length || p.tags.some((t) => tags.some((x) => t.toLowerCase() === x.toLowerCase()))) &&
        (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))),
    )
    return {
      total: hits.length,
      favorites: favorites.size,
      photos: hits.slice(0, Math.max(1, Math.min(500, limit))).map((p) => ({
        id: `lib:${p.id}`,
        name: p.name,
        tags: p.tags,
        faces: p.faces,
        favorite: favorites.has(`lib:${p.id}`),
        // Site-wide framing set in the editor wins over the detected one.
        ...(prefs.framing?.[`lib:${p.id}`] ?? { focusX: p.focusX, focusY: p.focusY }),
        thumb: join(PHOTO_LIBRARY, 'thumbs', `${p.id}.jpg`),
      })),
    }
  }

  async close() {
    await this.renderer.stop()
    this.server?.close()
  }
}

/** A client for an orbgen already listening on `port` — same method names. */
export async function connect(port = DEFAULT_PORT) {
  const base = `http://127.0.0.1:${port}`
  const health = await fetch(`${base}/v1/health`).then((r) => r.json()).catch(() => null)
  if (!health?.orbgen) return null
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
  }
  return {
    remote: true,
    options: () => call('GET', '/v1/options'),
    generate: (b) => call('POST', '/v1/generate', b),
    placeInFigma: (b) => call('POST', '/v1/figma/place', b),
    figmaStatus: () => call('GET', '/v1/figma/status'),
    libraryPhotos: ({ search, tags, selectsOnly, favoritesOnly, limit } = {}) => {
      const q = new URLSearchParams()
      if (search) q.set('search', search)
      for (const t of tags ?? []) q.append('tag', t)
      if (selectsOnly) q.set('selects', '1')
      if (favoritesOnly) q.set('favorites', '1')
      if (limit) q.set('limit', String(limit))
      return call('GET', `/v1/library?${q}`)
    },
    close: async () => {},
  }
}

/**
 * Own the port if it is free; otherwise attach to the orbgen that holds it.
 * Throws if something that is not orbgen holds the port.
 */
export async function startOrConnect(port = DEFAULT_PORT) {
  const service = new Orbgen({ port })
  try {
    await service.listen()
    return service
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err
    const client = await connect(port)
    if (client) return client
    throw new Error(`Port ${port} is in use by something other than orbgen — set ORBGEN_PORT`)
  }
}
