import dns from 'node:dns'
import net from 'node:net'

// Loopback, private, link-local, shared, benchmarking, documentation, multicast and reserved ranges: a trace URL that reaches one could reach the user's own network.
const PRIVATE_RANGES = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3]
] as const) {
  PRIVATE_RANGES.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
] as const) {
  PRIVATE_RANGES.addSubnet(address, prefix, 'ipv6')
}

function ipv6Groups(address: string): number[] {
  const [head = '', tail] = address.toLowerCase().split('::')
  const parts = (text: string): number[] =>
    text === ''
      ? []
      : text.split(':').flatMap((part) => {
          if (!part.includes('.')) {
            return [parseInt(part, 16)]
          }
          const [a, b, c, d] = part.split('.').map(Number)
          return [(a! << 8) | b!, (c! << 8) | d!]
        })
  const left = parts(head)
  if (tail === undefined) {
    return left
  }
  const right = parts(tail)
  return [
    ...left,
    ...Array<number>(8 - left.length - right.length).fill(0),
    ...right
  ]
}

function ipv4Of(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/** The IPv4 address an IPv6 one carries: NAT64 (64:ff9b::/96), 6to4 (2002::/16), IPv4-compatible (::/96) and SIIT (::ffff:0:0:0/96). Mapped addresses BlockList checks itself. */
function embeddedIpv4(groups: number[]): string | undefined {
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((group) => group === 0)
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) {
    return ipv4Of(groups[6]!, groups[7]!)
  }
  if (groups[0] === 0x2002) {
    return ipv4Of(groups[1]!, groups[2]!)
  }
  if (zeros(0, 6) || (zeros(0, 4) && groups[4] === 0xffff && groups[5] === 0)) {
    return ipv4Of(groups[6]!, groups[7]!)
  }
  return undefined
}

/** Whether an address is local or private, including an IPv4 one carried inside IPv6; anything that is not an IP address counts as private. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 0) {
    return true
  }
  if (family === 4) {
    return PRIVATE_RANGES.check(address, 'ipv4')
  }
  if (PRIVATE_RANGES.check(address, 'ipv6')) {
    return true
  }
  const embedded = embeddedIpv4(ipv6Groups(address))
  return embedded !== undefined && PRIVATE_RANGES.check(embedded, 'ipv4')
}

function hostMatches(host: string, allowed: string): boolean {
  return allowed.startsWith('*.')
    ? host.endsWith(allowed.slice(1)) && host.length > allowed.length - 1
    : host === allowed
}

/** Whether a URL's host is on the allowlist: an exact name, or `*.example.com` for any of its subdomains; a port other than 443 has to be listed with it (`host:8443`). */
export function isAllowedHost(
  url: URL,
  allowedHosts: readonly string[]
): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase()
    const colon = allowed.lastIndexOf(':')
    const port =
      colon > 0 && !allowed.endsWith(']') ? allowed.slice(colon + 1) : ''
    const name = port ? allowed.slice(0, colon) : allowed
    return hostMatches(host, name) && url.port === port
  })
}

type LookupAll = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: dns.LookupAddress[]
  ) => void
) => void

type AllAddresses = (error: null, addresses: dns.LookupAddress[]) => void

/** A `lookup` for an https request that refuses a host resolving to a private address, checked on the addresses the socket will connect to, so a rebinding DNS answer cannot slip past; Node calls no lookup for an IP literal, which the download checks itself. */
export function guardedLookup(
  allowPrivateNetwork: boolean,
  lookupAll: LookupAll = dns.lookup
): net.LookupFunction {
  return (hostname, options, callback) => {
    lookupAll(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0)
        return
      }
      const blocked = addresses.find(({ address }) => isPrivateAddress(address))
      if (blocked && !allowPrivateNetwork) {
        callback(
          new Error(
            `${hostname} resolves to ${blocked.address}, a local or private address; set allowPrivateNetwork to fetch from it`
          ),
          '',
          0
        )
        return
      }
      if (options.all) {
        // LookupFunction types its callback for one address; asked for `all`, Node expects the list, as dns.lookup gives it.
        ;(callback as unknown as AllAddresses)(null, addresses)
        return
      }
      callback(null, addresses[0]!.address, addresses[0]!.family)
    })
  }
}
