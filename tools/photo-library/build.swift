// Builds the local photo library the editor and orbgen read from
// `photo-library/` (untracked — client photos never go into this public repo).
//
//   swift tools/photo-library/build.swift <out-dir> <source-dir> [--as "Collection"] [<source-dir> …]
//
// Each source becomes a collection, named after its folder unless `--as`
// follows it (e.g. an `inbox` folder imported as "San Francisco"). A named
// collection is hand-picked, so its photos count as selects. Sources not
// given in this run keep their existing catalog entries untouched.
//
// For every JPEG/PNG/HEIC under the sources, once:
//   full/<id>.jpg    long edge ≤ 2048 px, EXIF orientation baked in, no metadata
//   thumbs/<id>.jpg  long edge ≤ 320 px, for the picker grid
// and writes catalog.json with each photo's size, folder tags, and a focal
// point from face detection (Vision) so a pool photo starts framed on people.
//
// Re-runnable: photos already in the catalog with their files present are
// kept as-is, so adding a folder only processes what is new. Duplicates
// become one photo carrying every folder it appeared in as a tag. "Same
// photo" is the same file name and aspect ratio within one source: the
// "selects" folders hold smaller re-exports of the "final high res" files, so
// pixel size alone misses them; the larger original is the one resized. A
// different aspect is a real crop and stays its own photo.

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let FULL_EDGE = 2048
let THUMB_EDGE = 320
let QUALITY = 0.82

struct Entry: Codable {
  var id: String
  var name: String
  var width: Int
  var height: Int
  var focusX: Double
  var focusY: Double
  var faces: Int
  var tags: [String]
  var selects: Bool
  var source: String
}

struct Catalog: Codable {
  var version: Int
  var generatedAt: String
  var photos: [Entry]
}

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: build.swift <out-dir> <source-dir> [--as \"Collection\"] …\n".data(using: .utf8)!)
  exit(2)
}
let outDir = URL(fileURLWithPath: args[1])
// Sources, each optionally renamed with a following `--as "Name"`.
var sources: [(url: URL, name: String, named: Bool)] = []
var rest = Array(args.dropFirst(2))
while !rest.isEmpty {
  let path = rest.removeFirst()
  let url = URL(fileURLWithPath: path)
  if rest.first == "--as", rest.count >= 2 {
    rest.removeFirst()
    sources.append((url, rest.removeFirst(), true))
  } else {
    sources.append((url, url.lastPathComponent, false))
  }
}
let fm = FileManager.default
try fm.createDirectory(at: outDir.appendingPathComponent("full"), withIntermediateDirectories: true)
try fm.createDirectory(at: outDir.appendingPathComponent("thumbs"), withIntermediateDirectories: true)

let catalogURL = outDir.appendingPathComponent("catalog.json")
var existing: [String: Entry] = [:]
var existingOrder: [Entry] = []
if let data = try? Data(contentsOf: catalogURL), let cat = try? JSONDecoder().decode(Catalog.self, from: data) {
  for e in cat.photos { existing[e.id] = e }
  existingOrder = cat.photos
}

func slug(_ s: String) -> String {
  let lowered = s.lowercased()
  var out = ""
  var dash = false
  for ch in lowered.unicodeScalars {
    if CharacterSet.alphanumerics.contains(ch) && ch.isASCII {
      out.unicodeScalars.append(ch)
      dash = false
    } else if !dash {
      out.append("-")
      dash = true
    }
  }
  return out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

/// Pixel size without decoding.
func pixelSize(_ url: URL) -> (Int, Int)? {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
    let w = props[kCGImagePropertyPixelWidth] as? Int,
    let h = props[kCGImagePropertyPixelHeight] as? Int
  else { return nil }
  let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
  return orientation >= 5 ? (h, w) : (w, h)
}

/// Downscale with orientation applied (ImageIO decodes at reduced size).
func downscaled(_ url: URL, edge: Int) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: edge,
    kCGImageSourceShouldCacheImmediately: true,
  ]
  return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
}

func writeJPEG(_ image: CGImage, to url: URL) -> Bool {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
  else { return false }
  // No metadata is copied: originals can carry GPS and camera serials.
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: QUALITY] as CFDictionary)
  return CGImageDestinationFinalize(dest)
}

/// Focal point from faces: anchored on the largest face, averaged (by area)
/// with faces at least half its size and within three of its widths — a
/// group shot centers on the group, but two people on opposite sides of the
/// frame no longer average to the empty wall between them. Image coordinates,
/// 0–1, y down. Defaults to center when no face is found.
func focus(_ image: CGImage) -> (Double, Double, Int) {
  let request = VNDetectFaceRectanglesRequest()
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  guard (try? handler.perform([request])) != nil, let faces = request.results, !faces.isEmpty else {
    return (0.5, 0.5, 0)
  }
  // Work in pixels so "three widths" means the same thing in both axes.
  let W = Double(image.width), H = Double(image.height)
  let boxes = faces.map { f -> (x: Double, y: Double, w: Double, area: Double) in
    let b = f.boundingBox
    let w = Double(b.width) * W, h = Double(b.height) * H
    return (Double(b.midX) * W, Double(1 - b.midY) * H, w, w * h)
  }
  let anchor = boxes.max { $0.area < $1.area }!
  var sx = 0.0, sy = 0.0, sw = 0.0
  for b in boxes where b.area >= anchor.area * 0.5 && hypot(b.x - anchor.x, b.y - anchor.y) <= anchor.w * 3 {
    sx += b.x * b.area
    sy += b.y * b.area
    sw += b.area
  }
  return (sx / sw / W, sy / sw / H, faces.count)
}

// ---- collect candidates ----
struct Candidate {
  var url: URL
  var id: String
  var name: String
  var tags: [String]
  var source: String
  var pixels: Int
}

var namedCollections = Set<String>()
var candidatesByKey: [String: Candidate] = [:]
var order: [String] = []
let exts: Set<String> = ["jpg", "jpeg", "png", "heic", "tif", "tiff"]
for (source, sourceName, named) in sources {
  if named { namedCollections.insert(sourceName) }
  let sourceSlug = slug(sourceName)
  guard let walker = fm.enumerator(at: source, includingPropertiesForKeys: [.isRegularFileKey]) else { continue }
  for case let url as URL in walker {
    guard exts.contains(url.pathExtension.lowercased()) else { continue }
    guard let (w, h) = pixelSize(url) else { continue }
    let base = url.deletingPathExtension().lastPathComponent
    let key = "\(sourceSlug)|\(base.lowercased())|\(String(format: "%.2f", Double(w) / Double(h)))"
    let rel = url.deletingLastPathComponent().path.replacingOccurrences(of: source.path, with: "")
    let folderTags = rel.split(separator: "/").map(String.init)
    if var c = candidatesByKey[key] {
      c.tags = Array(Set(c.tags + folderTags)).sorted()
      if w * h > c.pixels {
        c.url = url
        c.pixels = w * h
      }
      candidatesByKey[key] = c
    } else {
      var id = "\(sourceSlug)-\(slug(base))"
      if candidatesByKey.values.contains(where: { $0.id == id }) { id += "-\(w)x\(h)" }
      candidatesByKey[key] = Candidate(
        url: url, id: id, name: base, tags: [sourceName] + folderTags, source: sourceName, pixels: w * h)
      order.append(key)
    }
  }
}
let candidates = order.compactMap { candidatesByKey[$0] }
FileHandle.standardError.write("\(candidates.count) unique photos\n".data(using: .utf8)!)

// ---- process ----
var results = [Entry?](repeating: nil, count: candidates.count)
let lock = NSLock()
var done = 0
let started = Date()
DispatchQueue.concurrentPerform(iterations: candidates.count) { i in
  autoreleasepool {
    let c = candidates[i]
    let fullURL = outDir.appendingPathComponent("full/\(c.id).jpg")
    let thumbURL = outDir.appendingPathComponent("thumbs/\(c.id).jpg")
    let isSelect = namedCollections.contains(c.source)
      || c.tags.contains { $0.lowercased().contains("select") || $0.lowercased().contains("edit") }
    var entry: Entry?
    if var prior = existing[c.id], fm.fileExists(atPath: fullURL.path), fm.fileExists(atPath: thumbURL.path) {
      prior.tags = c.tags
      prior.selects = isSelect
      entry = prior
    } else if let full = downscaled(c.url, edge: FULL_EDGE), writeJPEG(full, to: fullURL),
      let thumb = downscaled(c.url, edge: THUMB_EDGE), writeJPEG(thumb, to: thumbURL)
    {
      let (fx, fy, n) = focus(full)
      entry = Entry(
        id: c.id, name: c.name, width: full.width, height: full.height,
        focusX: (fx * 1000).rounded() / 1000, focusY: (fy * 1000).rounded() / 1000,
        faces: n, tags: c.tags, selects: isSelect, source: c.source)
    }
    lock.lock()
    results[i] = entry
    done += 1
    if done % 100 == 0 || done == candidates.count {
      let rate = Double(done) / max(0.001, Date().timeIntervalSince(started))
      FileHandle.standardError.write(String(format: "%d/%d  (%.1f/s)\n", done, candidates.count, rate).data(using: .utf8)!)
    }
    lock.unlock()
  }
}

// Keep every existing photo whose source was not part of this run, so
// importing one folder never drops the rest of the library.
let thisRun = Set(sources.map { $0.name })
let kept = existingOrder.filter { !thisRun.contains($0.source) }
let processed = results.compactMap { $0 }
let photos = kept + processed
let catalog = Catalog(
  version: 1, generatedAt: ISO8601DateFormatter().string(from: Date()), photos: photos)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
try encoder.encode(catalog).write(to: catalogURL)
FileHandle.standardError.write("wrote \(photos.count) photos to \(catalogURL.path) (\(processed.count) from this run, \(kept.count) kept, \(candidates.count - processed.count) failed)\n".data(using: .utf8)!)
