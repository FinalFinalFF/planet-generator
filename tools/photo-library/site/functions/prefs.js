/**
 * Shared photo curation for the hosted photo library (Cloudflare Pages
 * Function at /prefs). Same protocol as the dev server and orbgen:
 *   GET  /prefs  → PhotoPrefs
 *   POST /prefs  ← PrefsDiff, → merged PhotoPrefs
 * (tools/photo-library/prefs-merge.mjs).
 *
 * Storage: the `PREFS` KV binding. Until one is bound, GET serves the
 * deployed seed (prefs.json, the curation at deploy time) and writes are
 * refused — read-only shared curation. Writes need the `x-orbgen-key` header
 * to match the `WRITE_KEY` secret (carried by the team's invite link).
 *
 * KV get/put is not atomic: two writes in the same instant can drop one
 * diff. Fine for a small team; revisit with a Durable Object if it bites.
 */
import { applyPrefsDiff, emptyPrefs, sanitizePrefs } from '../../prefs-merge.mjs'

const ALLOWED_ORIGINS = ['https://orbs.fnfn.us', 'http://localhost:5173', 'http://127.0.0.1:7331']

export async function onRequest({ request, env }) {
  const origin = request.headers.get('origin') ?? ''
  const cors = {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-orbgen-key',
    'access-control-expose-headers': 'x-orbgen-writable',
    vary: 'origin',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const kv = env.PREFS
  const keyOk = !env.WRITE_KEY || request.headers.get('x-orbgen-key') === env.WRITE_KEY
  const writable = Boolean(kv) && keyOk
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-orbgen-writable': writable ? '1' : '0',
      },
    })

  const read = async () => {
    const stored = kv ? await kv.get('prefs', 'json') : null
    if (stored) return sanitizePrefs(stored)
    const seed = await env.ASSETS.fetch(new URL('/prefs.json', request.url))
    return seed.ok ? sanitizePrefs(await seed.json()) : emptyPrefs()
  }

  if (request.method === 'GET') return json(200, await read())
  if (request.method !== 'POST') return json(405, { error: 'GET or POST' })
  if (!kv) return json(503, { error: 'Shared curation is read-only until a PREFS KV namespace is bound' })
  if (!keyOk) return json(403, { error: 'Missing or wrong write key' })
  let diff
  try {
    diff = await request.json()
  } catch {
    return json(400, { error: 'Body must be a JSON diff' })
  }
  const next = applyPrefsDiff(await read(), diff)
  await kv.put('prefs', JSON.stringify(next))
  return json(200, next)
}
