/**
 * Where the photo library lives for this browser.
 *
 * Default: `/photo-library`, served by the dev server and orbgen from the
 * local, untracked folder — the public site has none, so it 404s and the
 * library is simply empty.
 *
 * A team member gets the hosted library through an invite link:
 *   https://orbs.fnfn.us/?library=<hosted library URL>&key=<write key>
 * The source is remembered in localStorage and the parameters are stripped
 * from the address bar. The hosted URL deliberately never appears in the
 * public bundle: until the library sits behind Cloudflare Access, the link is
 * the only way in. `?library=local` forgets a hosted source.
 */

export type PhotoSource = {
  /** Base URL, no trailing slash: `/photo-library` or an absolute https URL. */
  base: string
  /** Write key for shared curation on a hosted library (from the invite link). */
  key?: string
  remote: boolean
}

const STORAGE_KEY = 'orbgen.photoLibrary.v1'
const LOCAL: PhotoSource = { base: '/photo-library', remote: false }

function resolve(): PhotoSource {
  if (typeof window === 'undefined') return LOCAL
  try {
    const params = new URLSearchParams(window.location.search)
    const library = params.get('library')
    if (library !== null) {
      params.delete('library')
      const key = params.get('key') ?? undefined
      params.delete('key')
      const rest = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash)
      if (library === 'local' || library === '') {
        localStorage.removeItem(STORAGE_KEY)
        return LOCAL
      }
      if (/^https:\/\//.test(library)) {
        const source: PhotoSource = { base: library.replace(/\/+$/, ''), key, remote: true }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(source))
        return source
      }
    }
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as PhotoSource | null
    if (saved && typeof saved.base === 'string' && /^https:\/\//.test(saved.base)) {
      return { base: saved.base, key: saved.key, remote: true }
    }
  } catch {
    // storage blocked or malformed — fall back to the local library
  }
  return LOCAL
}

/** Resolved once, at load: every library URL in the app derives from this. */
export const PHOTO_SOURCE: PhotoSource = resolve()
