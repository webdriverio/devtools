/**
 * The snapshot grammar is the contract between core's serializers (producer)
 * and the app's A11y-tree parser (consumer). It has already drifted once: the
 * parser knew only the web `[Page …]` form, so a native capture's `[android]`
 * header rendered as a tree node. These cases pin both forms in the package
 * that owns the grammar, rather than only in the app's browser specs.
 */

import { describe, it, expect } from 'vitest'
import {
  isSnapshotHeaderLine,
  parseSnapshotLine,
  snapshotNativeHeader,
  SNAPSHOT_NATIVE_PLATFORMS,
  SNAPSHOT_PAGE_HEADER
} from '../src/snapshot-format.js'

describe('isSnapshotHeaderLine', () => {
  it('accepts the web header the page serializer writes', () => {
    expect(
      isSnapshotHeaderLine('[Page: Login — https://the-internet.herokuapp.com]')
    ).toBe(true)
  })

  it('accepts a native header carrying a device and viewport', () => {
    expect(isSnapshotHeaderLine('[android — Pixel 7 (412×915)]')).toBe(true)
  })

  // What the per-action capture writes: it passes neither device nor viewport.
  // The platforms are LITERAL here on purpose — looping over
  // `SNAPSHOT_NATIVE_PLATFORMS` derives the expectation from the value under
  // test, so dropping a platform would simply loop less and still pass.
  it('accepts a bare native header for each supported platform', () => {
    expect(isSnapshotHeaderLine('[android]')).toBe(true)
    expect(isSnapshotHeaderLine('[ios]')).toBe(true)
  })

  it('supports exactly the platforms the serializers write', () => {
    expect([...SNAPSHOT_NATIVE_PLATFORMS]).toEqual(['android', 'ios'])
  })

  it('rejects a tree node, however bracket-heavy its role', () => {
    expect(isSnapshotHeaderLine('  button "Login" → button*=Login')).toBe(false)
    expect(isSnapshotHeaderLine('  textbox [required] → #username')).toBe(false)
  })

  it('rejects a platform name that is not at the start of the line', () => {
    expect(isSnapshotHeaderLine('  link "[android] build" → a=build')).toBe(
      false
    )
  })

  it('rejects an unknown platform', () => {
    expect(isSnapshotHeaderLine('[windows — Surface (1920×1080)]')).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(isSnapshotHeaderLine('')).toBe(false)
  })
})

describe('snapshotNativeHeader', () => {
  it('prefixes each platform so both header forms match it', () => {
    for (const platform of SNAPSHOT_NATIVE_PLATFORMS) {
      const prefix = snapshotNativeHeader(platform)
      expect(prefix).toBe(`[${platform}`)
      // The bare and the device/viewport forms must both start with it.
      expect(`${prefix}]`.startsWith(prefix)).toBe(true)
      expect(`${prefix} — Pixel 7 (412×915)]`.startsWith(prefix)).toBe(true)
    }
  })

  it('never collides with the web header prefix', () => {
    for (const platform of SNAPSHOT_NATIVE_PLATFORMS) {
      expect(snapshotNativeHeader(platform)).not.toBe(SNAPSHOT_PAGE_HEADER)
    }
  })
})

describe('parseSnapshotLine', () => {
  it('reads depth, role, name and the locator of an element line', () => {
    expect(
      parseSnapshotLine('      textbox "Username" ∈ "Login"  →  #username')
    ).toEqual({
      depth: 2,
      role: 'textbox',
      name: 'Username',
      purpose: 'Login',
      label: 'textbox "Username" ∈ "Login"',
      selector: '#username'
    })
  })

  it('reads a structural line with no locator', () => {
    expect(parseSnapshotLine('  form')).toEqual({
      depth: 0,
      role: 'form',
      name: '',
      label: 'form'
    })
  })

  it('keeps an arrow in a name and in an XPath text locator', () => {
    expect(
      parseSnapshotLine('    link "Next →"  →  //a[contains(., "Next →")]')
    ).toEqual({
      depth: 1,
      role: 'link',
      name: 'Next →',
      label: 'link "Next →"',
      selector: '//a[contains(., "Next →")]'
    })
  })

  it('keeps a quote inside a name', () => {
    expect(parseSnapshotLine('  button "Say "hi""  →  #say')).toMatchObject({
      name: 'Say "hi"',
      selector: '#say'
    })
  })

  it('reads a purpose with no name, and a locator with neither', () => {
    expect(
      parseSnapshotLine('  button ∈ "Checkout"  →  //button[2]')
    ).toMatchObject({
      role: 'button',
      name: '',
      purpose: 'Checkout',
      label: 'button ∈ "Checkout"',
      selector: '//button[2]'
    })
    expect(parseSnapshotLine('  switch  →  ~wifi')).toMatchObject({
      role: 'switch',
      label: 'switch',
      selector: '~wifi'
    })
  })

  it('reads a long hostile line in linear time', () => {
    const line = `  x "${'" ∈ "'.repeat(50_000)}`
    const started = performance.now()
    parseSnapshotLine(line)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('reads neither the header nor a blank line as a node', () => {
    expect(parseSnapshotLine('[Page: Login]')).toBe(null)
    expect(parseSnapshotLine('[android]')).toBe(null)
    expect(parseSnapshotLine('   ')).toBe(null)
  })
})
