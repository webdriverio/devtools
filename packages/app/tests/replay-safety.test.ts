import { describe, expect, it } from 'vitest'

import {
  isUnsafeReplayAttribute,
  isUnsafeReplayElement
} from '../src/components/browser/replay-safety.js'

describe('isUnsafeReplayAttribute', () => {
  it.each([
    ['onload', 'top.x = 1'],
    ['onError', 'top.x = 1'],
    ['ONCLICK', 'top.x = 1'],
    ['srcdoc', '<script>top.x = 1</script>'],
    ['http-equiv', 'refresh'],
    ['href', 'javascript:top.x = 1'],
    ['href', '  JavaScript:top.x = 1'],
    ['src', 'javascript:top.x = 1'],
    ['action', 'javascript:top.x = 1'],
    ['formaction', 'javascript:top.x = 1'],
    ['xlink:href', 'javascript:top.x = 1']
  ])('refuses %s="%s"', (name, value) => {
    expect(isUnsafeReplayAttribute(name, value)).toBe(true)
  })

  it.each([
    ['href', 'https://example.com/javascript:x'],
    ['src', 'data:image/png;base64,AAAA'],
    ['class', 'onload'],
    ['data-on', 'x'],
    ['title', 'javascript:x']
  ])('keeps %s="%s"', (name, value) => {
    expect(isUnsafeReplayAttribute(name, value)).toBe(false)
  })
})

describe('isUnsafeReplayElement', () => {
  it('refuses a script in any case', () => {
    expect(isUnsafeReplayElement('script')).toBe(true)
    expect(isUnsafeReplayElement('SCRIPT')).toBe(true)
  })

  it('keeps everything else', () => {
    expect(isUnsafeReplayElement('img')).toBe(false)
    expect(isUnsafeReplayElement(undefined)).toBe(false)
  })
})
