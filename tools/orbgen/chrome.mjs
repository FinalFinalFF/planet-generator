/**
 * A long-lived headless Chrome holding the app's `api.html`, driven over the
 * DevTools protocol. Generation calls `window.orbgen.generate()` inside that
 * page, so output comes from the app's own renderer and exporter.
 *
 * Real time, never `--virtual-time-budget`: image decoding and IndexedDB never
 * resolve under virtual time (see CLAUDE.md).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!found) throw new Error('Chrome not found — set CHROME_PATH to a Chrome or Chromium binary')
  return found
}

export class Renderer {
  /** @param {string} pageUrl full URL of api.html */
  constructor(pageUrl) {
    this.pageUrl = pageUrl
    this.proc = null
    this.ws = null
    this.nextId = 0
    this.pending = new Map()
    this.starting = null
    this.profile = null
  }

  async start() {
    this.starting ??= this.#launch().catch((err) => {
      this.starting = null
      throw err
    })
    return this.starting
  }

  async #launch() {
    this.profile = await mkdtemp(join(tmpdir(), 'orbgen-chrome-'))
    this.proc = spawn(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${this.profile}`,
        '--remote-debugging-port=0',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    this.proc.on('exit', () => {
      this.ws = null
      this.starting = null
      for (const { reject } of this.pending.values()) reject(new Error('Chrome exited'))
      this.pending.clear()
    })
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('Chrome did not start within 20s')), 20000)
      this.proc.stderr.on('data', (d) => {
        buf += d
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
    })
    const port = new URL(wsUrl).port
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const page = targets.find((t) => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error('Could not connect to Chrome'))
    })
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const p = msg.id && this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    }
    await this.#send('Page.enable')
    await this.#send('Page.navigate', { url: this.pageUrl })
    // Wait for the API object, then for every pattern to parse.
    const deadline = Date.now() + 30000
    for (;;) {
      const r = await this.#eval('typeof window.orbgen === "object"')
      if (r === true) break
      if (Date.now() > deadline) {
        throw new Error(`${this.pageUrl} never exposed window.orbgen — is the app built and served?`)
      }
      await new Promise((res) => setTimeout(res, 150))
    }
    await this.#eval('window.orbgen.ready')
  }

  #send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async #eval(expression) {
    const r = await this.#send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error(
        (d.exception?.description?.split('\n')[0] ?? d.text ?? 'Evaluation failed').replace(/^\w*Error: /, ''),
      )
    }
    return r.result.value
  }

  /**
   * Call `window.orbgen[fn](arg)` and return its (JSON-able) result.
   *
   * Calls run one at a time: each render mounts an offscreen <svg> whose defs
   * are referenced by id, and two runs interleaving in one page would share
   * ids (`o1-…`) — `url(#…)` resolves to the first match, so one run would
   * paint with the other's gradients.
   */
  call(fn, arg) {
    const run = async () => {
      await this.start()
      return this.#eval(`window.orbgen.${fn}(${arg === undefined ? '' : JSON.stringify(arg)})`)
    }
    const result = (this.queue ?? Promise.resolve()).then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  async stop() {
    this.proc?.kill()
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {})
  }
}
