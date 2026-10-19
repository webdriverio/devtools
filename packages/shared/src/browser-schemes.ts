/** The browser's own pages, which no server answers for: start, error and
 *  new-tab pages, extensions, devtools. Chrome's family is matched by prefix. */
export const BROWSER_INTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  'about',
  'chrome',
  'chrome-error',
  'chrome-extension',
  'chrome-native',
  'chrome-search',
  'chrome-untrusted',
  'devtools',
  'edge',
  'moz-extension',
  'safari-web-extension'
])

const SCHEME = /^([a-z][a-z0-9+.-]*):/

/** The scheme a URL names, lower-cased; a relative URL names none. */
export function schemeOf(url: string): string | undefined {
  return SCHEME.exec(url.toLowerCase())?.[1]
}

export function isBrowserInternalUrl(url: string): boolean {
  const scheme = schemeOf(url)
  return (
    scheme !== undefined &&
    (BROWSER_INTERNAL_SCHEMES.has(scheme) || scheme.startsWith('chrome-'))
  )
}
