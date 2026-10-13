/**
 * The photo library behind `photo` sector cells.
 *
 * Photos live in IndexedDB, not localStorage: one photo is easily bigger than
 * the whole localStorage budget the document, presets and imported patterns
 * share. The document stores only a `photoId`, so undo history, presets and
 * remix never copy image bytes.
 *
 * Each photo is kept as a data URL, and that same string is what the renderer
 * puts in `<image href>`. That keeps the one-SVG invariant intact: SVG export
 * is still a plain serialization (the image is embedded, so Figma and other
 * importers get it), and the PNG rasterizer can load it — an SVG drawn
 * through `<img>` may not fetch external or blob: URLs.
 */

import { createContext, useContext } from 'react'

export type Photo = {
  id: string
  name: string
  /** `data:image/jpeg|png;base64,…` — downscaled at import. */
  dataUrl: string
  width: number
  height: number
  addedAt: number
}

/**
 * Long-edge cap at import. The canvas is 1600px and a cell is at most the
 * whole disc, so this leaves room to zoom in about 2× before softening,
 * while keeping each photo around 1 MB.
 */
const MAX_EDGE = 3200
const JPEG_QUALITY = 0.88

const DB_NAME = 'orbgen.photos'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the photo library'))
  })
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error ?? new Error('Photo library transaction failed'))
      t.onabort = () => reject(t.error ?? new Error('Photo library transaction aborted'))
    })
  } finally {
    db.close()
  }
}

export async function listPhotos(): Promise<Photo[]> {
  try {
    const all = await tx<Photo[]>('readonly', (s) => s.getAll() as IDBRequest<Photo[]>)
    return all.sort((a, b) => a.addedAt - b.addedAt)
  } catch {
    // Private windows and blocked storage: the app still works, just without
    // a persisted library.
    return []
  }
}

export async function deletePhoto(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

/**
 * Decode and downscale an image into a `Photo`, without storing it — the
 * headless API (`src/api.tsx`) uses this directly. PNG input stays PNG (it may
 * carry transparency); everything else is re-encoded as JPEG.
 */
export async function decodePhoto(file: Blob, filename: string): Promise<Photo> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`Could not read ${filename} — try a JPEG or PNG`)
  }
  const k = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * k))
  const height = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas 2D is unavailable')
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const png = file.type === 'image/png'
  const dataUrl = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', JPEG_QUALITY)
  return {
    id: `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: filename.replace(/\.[^.]+$/, '') || 'Photo',
    dataUrl,
    width,
    height,
    addedAt: Date.now(),
  }
}

/** Decode, downscale and store an image file in the library. */
export async function importPhotoFile(file: File): Promise<Photo> {
  const photo = await decodePhoto(file, file.name)
  try {
    await tx('readwrite', (s) => s.put(photo))
  } catch {
    throw new Error('Could not save the photo — browser storage may be full or blocked')
  }
  return photo
}

/* ---------- the photo library catalog ---------- */

/**
 * A photo the user can pick, loaded or not: uploads (IndexedDB) and the local
 * photo library (`photo-library/`, built by tools/photo-library/build.swift —
 * resized client photos, untracked, served by the dev server and orbgen but
 * absent from the public site). Thousands of library photos cannot all sit in
 * memory as data URLs, so the catalog is metadata + thumbnails, and a full
 * image is loaded only once a pool or cell uses it.
 */
export type PhotoMeta = {
  id: string
  name: string
  width: number
  height: number
  /** Small image for pickers: a library thumbnail, or an upload's own data URL. */
  thumbUrl: string
  /** Suggested framing — face detection for library photos, center otherwise. */
  focusX: number
  focusY: number
  tags: string[]
  /** From a curated "selects"/"edits" folder. */
  selects: boolean
  /** Faces detected (library photos). */
  faces?: number
  origin: 'library' | 'upload'
}

/** Library photo ids are namespaced so they can never collide with uploads. */
export const LIBRARY_PREFIX = 'lib:'
export const PHOTO_LIBRARY_BASE = '/photo-library'

type CatalogFile = {
  photos: Array<{
    id: string
    name: string
    width: number
    height: number
    focusX: number
    focusY: number
    tags: string[]
    selects: boolean
    faces?: number
  }>
}

/** The local photo library's catalog, or [] where there is none (the public site). */
export async function loadCatalog(base = PHOTO_LIBRARY_BASE): Promise<PhotoMeta[]> {
  try {
    const res = await fetch(`${base}/catalog.json`)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return []
    const cat = (await res.json()) as CatalogFile
    return cat.photos.map((p) => ({
      id: `${LIBRARY_PREFIX}${p.id}`,
      name: p.name,
      width: p.width,
      height: p.height,
      thumbUrl: `${base}/thumbs/${encodeURIComponent(p.id)}.jpg`,
      focusX: p.focusX,
      focusY: p.focusY,
      tags: p.tags,
      selects: p.selects,
      faces: p.faces,
      origin: 'library' as const,
    }))
  } catch {
    return []
  }
}

export function uploadMeta(photo: Photo): PhotoMeta {
  return {
    id: photo.id,
    name: photo.name,
    width: photo.width,
    height: photo.height,
    thumbUrl: photo.dataUrl,
    focusX: 0.5,
    focusY: 0.5,
    tags: ['Uploads'],
    selects: false,
    origin: 'upload',
  }
}

/** A URL for the full-size image, for display (the renderer uses data URLs). */
export function fullUrlFor(meta: PhotoMeta, base = PHOTO_LIBRARY_BASE): string {
  if (meta.origin === 'upload') return meta.thumbUrl
  return `${base}/full/${encodeURIComponent(meta.id.slice(LIBRARY_PREFIX.length))}.jpg`
}

/**
 * Load a library photo's full image as a data URL — the form the renderer
 * embeds (see the module comment). The file is already resized and
 * orientation-corrected, so it is not re-encoded.
 */
export async function loadLibraryPhoto(meta: PhotoMeta, base = PHOTO_LIBRARY_BASE): Promise<Photo> {
  const raw = meta.id.slice(LIBRARY_PREFIX.length)
  const res = await fetch(`${base}/full/${encodeURIComponent(raw)}.jpg`)
  if (!res.ok) throw new Error(`Photo ${meta.name} is missing from the library`)
  const blob = await res.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read photo'))
    reader.readAsDataURL(blob)
  })
  return { id: meta.id, name: meta.name, dataUrl, width: meta.width, height: meta.height, addedAt: 0 }
}

/**
 * Loaded photos by id (full data URLs), provided once by `App` so every
 * `OrbSvg` — the stage, batch cells — renders from the same set without
 * threading a prop. A photo missing here renders as an empty cell until it
 * loads.
 */
export const PhotosContext = createContext<Map<string, Photo>>(new Map())

export function usePhotos(): Map<string, Photo> {
  return useContext(PhotosContext)
}

/** Everything pickable — uploads first, then the library — by id and in order. */
export type PhotoLibrary = { list: PhotoMeta[]; byId: Map<string, PhotoMeta> }

export const PhotoLibraryContext = createContext<PhotoLibrary>({ list: [], byId: new Map() })

export function usePhotoLibrary(): PhotoLibrary {
  return useContext(PhotoLibraryContext)
}
