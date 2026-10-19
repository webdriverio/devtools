import { describe, expect, it } from 'vitest'

import { isBrowserInternalUrl, schemeOf } from '../src/browser-schemes.js'

describe('schemeOf', () => {
  it('reads a scheme case-insensitively and only where one is named', () => {
    expect(schemeOf('CHROME://settings')).toBe('chrome')
    expect(schemeOf('https://x/a:b')).toBe('https')
    expect(schemeOf('/api/me')).toBeUndefined()
    // A colon later in a relative path is not a scheme separator.
    expect(schemeOf('chrome-dashboard/export?from=10:00')).toBeUndefined()
    expect(schemeOf('localhost:8080/x')).toBe('localhost')
  })
})

describe('isBrowserInternalUrl', () => {
  it("names the browser's own pages and nothing a server answers for", () => {
    for (const url of [
      'about:blank',
      'chrome://settings',
      'chrome-native://newtab/',
      'chrome-untrusted://new-tab-page/',
      'chrome-error://chromewebdata/',
      'chrome-extension://abc/page.html',
      'devtools://devtools/bundled/inspector.html',
      'edge://settings',
      'moz-extension://abc/page.html'
    ]) {
      expect(isBrowserInternalUrl(url), url).toBe(true)
    }
    for (const url of [
      'https://app.test/login',
      'http://localhost:8080/',
      'data:text/plain,hello',
      'blob:https://app.test/1234',
      'chrome-dashboard/export?from=10:00',
      '/relative/path'
    ]) {
      expect(isBrowserInternalUrl(url), url).toBe(false)
    }
  })
})
