/** Detect image mime from a base64 string's magic bytes — trace screenshots
 *  may be PNG (polling capture) or JPEG (CDP), and the zip names both `.jpeg`. */
export function imageMime(base64: string): string {
  return base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'
}

/** `m:ss.cc` timecode (e.g. 32_270ms → `0:32.27`). */
export function formatTimecode(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centis = Math.floor((safe % 1000) / 10)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis
    .toString()
    .padStart(2, '0')}`
}
