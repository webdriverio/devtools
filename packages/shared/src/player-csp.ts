// The replay renders a recorded page in a same-origin iframe, so the policy is
// what stops a crafted trace from running script or sending data anywhere.
const PLAYER_CSP_DIRECTIVES: readonly (readonly [string, string])[] = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['connect-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline' https: http:"],
  ['img-src', '* data: blob:'],
  ['font-src', '* data:'],
  ['media-src', "'self' data: blob:"],
  ['object-src', "'none'"],
  ['base-uri', "'self' https: http:"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"]
]

/** The trace player's Content-Security-Policy, with extra `connect-src` sources appended. */
export function playerCsp(connectSrc: readonly string[] = []): string {
  return PLAYER_CSP_DIRECTIVES.map(([name, value]) =>
    name === 'connect-src' && connectSrc.length
      ? `${name} ${value} ${connectSrc.join(' ')}`
      : `${name} ${value}`
  ).join('; ')
}

// A trace opened by `?trace=<url>` can live on any https host; every other directive is the local player's.
const HOSTED_CONNECT_SRC: readonly string[] = ['https:']

/** The policy trace.webdriver.io sends: the player's, with `connect-src` widened to https for `?trace=`. */
export function hostedPlayerCsp(): string {
  return playerCsp(HOSTED_CONNECT_SRC)
}

// A Host header is reflected into the policy only when it names a host, never a header fragment.
const HOST_HEADER = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

/** The live dashboard's socket source for a request's Host header, or none for one that is not a plain host. */
export function dashboardSocketSource(host: string | undefined): string[] {
  return host && HOST_HEADER.test(host) ? [`ws://${host}`] : []
}
