/** Base64 magic of a PNG signature — the 8-byte header encodes deterministically. */
const PNG_BASE64_MAGIC = 'iVBOR'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_IHDR_WIDTH_OFFSET = 16
const PNG_IHDR_END = 24
const JPEG_SOI = [0xff, 0xd8]
/** A frame header names the image's size; DHT/JPG/DAC share the 0xC0-0xCF range. */
const JPEG_SOF_EXCLUDED = [0xc4, 0xc8, 0xcc]
/** Start of scan — the entropy-coded data begins, so no header follows. */
const JPEG_SOS = 0xda
/** Prefixes decoded in turn, in bytes. A capture is megabytes and only its
 *  header is ever read, so the small window serves every PNG (its size sits at
 *  a fixed offset 16 bytes in) and almost every JPEG. The large one is for a
 *  JPEG carrying metadata ahead of its frame header — EXIF and an embedded
 *  thumbnail put it 35 KB in on a device-farm capture, and each APPn segment
 *  may be 64 KB. */
const HEADER_WINDOWS = [4096, 1_048_576]

export interface ImageSize {
  width: number
  height: number
}

/** Detect image mime from a base64 string's magic bytes — trace screenshots may
 *  be PNG (polling capture) or JPEG (CDP), and the zip names both `.jpeg`. */
export function imageMime(base64: string): string {
  return base64.startsWith(PNG_BASE64_MAGIC) ? 'image/png' : 'image/jpeg'
}

/** Intrinsic pixel size read out of a base64 PNG or JPEG header, or null when
 *  the bytes name none. A capture is fitted by this rather than by the metadata
 *  viewport: the two disagree on both mobile platforms — Android reports the
 *  window without the nav bar, iOS reports points, not pixels. */
export function imageDimensions(base64: string): ImageSize | null {
  for (const window of HEADER_WINDOWS) {
    const bytes = headerBytes(base64, window)
    const size = pngSize(bytes) ?? jpegSize(bytes)
    // A zero from a corrupt or truncated header is not a size — a caller
    // deriving a ratio from it gets a 0/0 that collapses whatever it shapes.
    if (size && size.width > 0 && size.height > 0) {
      return size
    }
    // A prefix short of the window it asked for is the whole image: a wider
    // one would decode the same bytes again.
    if (bytes.length < window) {
      break
    }
  }
  return null
}

/** The first `limit` bytes of a base64 string, sliced to a whole number of
 *  base64 groups so the decode never straddles one. Input that is not base64 at
 *  all (a `data:` url, a truncated frame) names no size — the null contract. */
function headerBytes(base64: string, limit: number): Uint8Array {
  const prefix = base64.slice(0, Math.ceil(limit / 3) * 4)
  const groups = prefix.slice(0, prefix.length - (prefix.length % 4))
  let binary = ''
  try {
    binary = atob(groups)
  } catch {
    return new Uint8Array()
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.length < PNG_IHDR_END ||
    PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)
  ) {
    return null
  }
  return {
    width: u32(bytes, PNG_IHDR_WIDTH_OFFSET),
    height: u32(bytes, PNG_IHDR_WIDTH_OFFSET + 4)
  }
}

/** Walk the segment chain to the frame header. JPEG puts the size there rather
 *  than at a fixed offset, and any number of metadata segments may precede it. */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (JPEG_SOI.some((byte, i) => bytes[i] !== byte)) {
    return null
  }
  let at = JPEG_SOI.length
  while (at + 8 < bytes.length) {
    // 0xFF repeats as segment padding, so advance to the marker byte itself.
    if (bytes[at] !== 0xff) {
      return null
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    if (isSofMarker(marker)) {
      return { height: u16(bytes, at + 5), width: u16(bytes, at + 7) }
    }
    if (marker === JPEG_SOS) {
      return null
    }
    // Every marker reachable here carries a length: the walk starts past SOI
    // and stops at SOS, so the length-less ones (SOI, EOI, RST) are behind it.
    at += 2 + u16(bytes, at + 2)
  }
  return null
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && !JPEG_SOF_EXCLUDED.includes(marker)
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  )
}
