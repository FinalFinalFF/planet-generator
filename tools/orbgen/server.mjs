#!/usr/bin/env node
/**
 * Standalone orbgen server: the local REST API + Figma bridge.
 *   node tools/orbgen/server.mjs        (or `npm run orbs:server` at the repo root)
 * Env: ORBGEN_PORT (default 7331), ORBGEN_APP_URL (render from a running dev
 * server instead of dist/), CHROME_PATH.
 */
import { Orbgen, DEFAULT_PORT } from './service.mjs'

const service = new Orbgen({ port: DEFAULT_PORT })
try {
  await service.listen()
} catch (err) {
  console.error(
    err?.code === 'EADDRINUSE'
      ? `Port ${DEFAULT_PORT} is already in use (another orbgen?). Set ORBGEN_PORT to run a second one.`
      : err,
  )
  process.exit(1)
}
console.log(`orbgen listening on http://127.0.0.1:${DEFAULT_PORT}  (rendering ${service.pageUrl})`)
console.log('  POST /v1/generate · POST /v1/figma/place · GET /v1/options · GET /v1/figma/status')

const shutdown = async () => {
  await service.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
