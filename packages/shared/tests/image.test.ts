import { describe, expect, it } from 'vitest'

import { imageDimensions, imageMime } from '../src/image.js'

/** 12x26 and 32x20 RGB PNGs — asymmetric so a swapped axis fails the test. */
const PORTRAIT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAaCAIAAAAMmCo2AAAAGElEQVR42mPQiDpBEDGMKhpVNKpocCoCABkvkkCF7UyEAAAAAElFTkSuQmCC'
const LANDSCAPE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAUCAIAAABj86gYAAAAIElEQVR42mM4EaVBU8QwasGoBaMWjFowasGoBaMWEIMASNw5LplhiRIAAAAASUVORK5CYII='
/** 12x26 JPEG carrying a JFIF segment ahead of its frame header, so the size is
 *  only reachable by walking the segment chain. */
const PORTRAIT_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/wAALCAAaAAwBAREA/9oACAEBAAA/AP/Z'

/** The same JPEG with a metadata segment padded out ahead of its frame header —
 *  the shape a capture carrying EXIF and an embedded thumbnail has, which put
 *  the frame header 35 KB into a device-farm frame. */
function behindMetadata(jpeg: string, padding: number): string {
  const source = Uint8Array.from(atob(jpeg), (char) => char.charCodeAt(0))
  const segment = new Uint8Array(padding + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment[2] = ((padding + 2) >> 8) & 0xff
  segment[3] = (padding + 2) & 0xff

  const out = new Uint8Array(source.length + segment.length)
  out.set(source.subarray(0, 2))
  out.set(segment, 2)
  out.set(source.subarray(2), 2 + segment.length)

  let binary = ''
  for (const byte of out) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

describe('imageMime', () => {
  it('names a PNG from its signature', () => {
    expect(imageMime(PORTRAIT_PNG)).toBe('image/png')
  })

  it('names anything else JPEG — the only other capture format', () => {
    expect(imageMime(PORTRAIT_JPEG)).toBe('image/jpeg')
    expect(imageMime('AAAA')).toBe('image/jpeg')
  })
})

describe('imageDimensions', () => {
  it("reads a PNG's IHDR", () => {
    expect(imageDimensions(PORTRAIT_PNG)).toEqual({ width: 12, height: 26 })
    expect(imageDimensions(LANDSCAPE_PNG)).toEqual({ width: 32, height: 20 })
  })

  it("walks a JPEG's segments to its frame header", () => {
    expect(imageDimensions(PORTRAIT_JPEG)).toEqual({ width: 12, height: 26 })
  })

  it('steps over a DHT segment rather than reading it as the frame header', () => {
    // DHT is 0xC4 — inside the 0xC0-0xCF frame-header range. Read as one, this
    // 12x26 JPEG measures 8755x4386, so the exclusion is what makes it right.
    expect(
      imageDimensions('/9j/xAAMEREiIjMzRERVVf/AAAsIABoADAEBEQD/2Q==')
    ).toEqual({ width: 12, height: 26 })
  })

  it('keeps walking past metadata larger than the first header window', () => {
    expect(imageDimensions(behindMetadata(PORTRAIT_JPEG, 5_000))).toEqual({
      width: 12,
      height: 26
    })
  })

  it('is null when the bytes name no size', () => {
    expect(imageDimensions('')).toBeNull()
    expect(imageDimensions('AAAA')).toBeNull()
    // A `data:` prefix is not base64, so the decode itself fails.
    expect(imageDimensions(`data:image/png;base64,${PORTRAIT_PNG}`)).toBeNull()
    // PNG signature, IHDR truncated away.
    expect(imageDimensions(PORTRAIT_PNG.slice(0, 8))).toBeNull()
  })

  it('is null for a JPEG whose scan starts before any frame header', () => {
    expect(imageDimensions('/9j/2gAIAQEAAD8A/9k=')).toBeNull()
  })

  it('is null when a header names a zero axis', () => {
    // Same PNG with its IHDR width zeroed — a ratio taken off it collapses.
    expect(
      imageDimensions(
        'iVBORw0KGgoAAAANSUhEUgAAAAAAAAAaCAIAAAAMmCo2AAAAGElEQVR42mPQiDpBEDGMKhpVNKpocCoCABkvkkCF7UyEAAAAAElFTkSuQmCC'
      )
    ).toBeNull()
  })
})
