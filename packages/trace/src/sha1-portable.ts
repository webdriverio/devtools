// Sync and browser-safe for the reader; resource bytes keep native `sha1Hex`, ~30x faster.

const UTF8 = new TextEncoder()

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits))
}

function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  out.set(bytes)
  out[bytes.length] = 0x80
  const view = new DataView(out.buffer)
  const bits = bytes.length * 8
  view.setUint32(out.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(out.length - 4, bits >>> 0)
  return out
}

function roundMix(i: number, b: number, c: number, d: number): number {
  if (i < 20) {
    return ((b & c) | (~b & d)) + 0x5a827999
  }
  if (i < 40) {
    return (b ^ c ^ d) + 0x6ed9eba1
  }
  if (i < 60) {
    return ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc
  }
  return (b ^ c ^ d) + 0xca62c1d6
}

/** Hex SHA-1 of a string's UTF-8 bytes, identical to `sha1Hex(text)`. */
export function portableSha1Hex(text: string): string {
  const message = padded(UTF8.encode(text))
  const view = new DataView(message.buffer)
  const w = new Uint32Array(80)
  const h = new Int32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0
  ])
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4)
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      const next = (rotl(a, 5) + roundMix(i, b, c, d) + e + w[i]) | 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = next
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
  }
  return Array.from(h, (word) =>
    (word >>> 0).toString(16).padStart(8, '0')
  ).join('')
}
