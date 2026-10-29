// Browser-safe for the hosted player; `btoa` is ~190x slower, so it is the last resort.

interface NativeBase64 {
  toBase64?: () => string
}

interface NodeBuffer {
  from(bytes: Uint8Array): { toString(encoding: 'base64'): string }
}

// A multiple of 3, so each chunk encodes without padding and they concatenate.
const CHUNK_BYTES = 0x8000 - (0x8000 % 3)

function btoaChunked(bytes: Uint8Array): string {
  let base64 = ''
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    base64 += btoa(
      String.fromCharCode(...bytes.subarray(start, start + CHUNK_BYTES))
    )
  }
  return base64
}

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as NativeBase64).toBase64
  if (native) {
    return native.call(bytes)
  }
  const buffer = (globalThis as { Buffer?: NodeBuffer }).Buffer
  return buffer ? buffer.from(bytes).toString('base64') : btoaChunked(bytes)
}
