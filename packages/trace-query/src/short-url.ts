import type { NetworkRequest } from '@wdio/devtools-shared'

function originOf(url: string): string | undefined {
  try {
    const origin = new URL(url).origin
    // data: and about: URLs have an opaque origin, which names no server.
    return origin === 'null' ? undefined : origin
  } catch {
    // A URL that does not parse has no origin, so it is listed whole rather than refused.
    return undefined
  }
}

/** The origin most rows share, which a listing states once: the first document's, else the most frequent. */
export function mainOrigin(
  requests: readonly NetworkRequest[]
): string | undefined {
  const document = requests.find((request) => request.type === 'document')
  const fromDocument = document && originOf(document.url)
  if (fromDocument) {
    return fromDocument
  }
  const counts = new Map<string, number>()
  for (const request of requests) {
    const origin = originOf(request.url)
    if (origin) {
      counts.set(origin, (counts.get(origin) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** The URL without the main origin, read off its text so credentials, an explicit port or a scheme prefix keep the URL whole. */
export function withoutOrigin(url: string, origin: string | undefined): string {
  if (origin === undefined || !url.startsWith(origin)) {
    return url
  }
  const rest = url.slice(origin.length)
  if (rest.startsWith('/')) {
    return rest
  }
  return rest.startsWith('?') || rest.startsWith('#') ? `/${rest}` : url
}
