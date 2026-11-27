import type dns from 'node:dns'
import { describe, expect, it } from 'vitest'
import {
  guardedLookup,
  isAllowedHost,
  isPrivateAddress
} from '../src/network-guard.js'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::FFFF:10.0.0.1',
    '::ffff:a00:1',
    '64:ff9b::a00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::1',
    '::7f00:1',
    '::ffff:0:7f00:1',
    '2002:a00:1::',
    '2002:7f00:1::1',
    '2001::1',
    '2001:db8::1',
    'fec0::1',
    '100::1',
    '198.18.0.1',
    '192.0.0.1',
    'not-an-address'
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1'
  ])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('isAllowedHost', () => {
  const allowed = [
    'bucket.example.com',
    '*.traces.example.org',
    'store.example.net:8443'
  ]

  it.each([
    ['https://bucket.example.com/a.zip', true],
    ['https://BUCKET.Example.com/a.zip', true],
    ['https://bucket.example.com./a.zip', true],
    ['https://bucket.example.com:443/a.zip', true],
    ['https://eu.traces.example.org/a.zip', true],
    ['https://a.b.traces.example.org/a.zip', true],
    ['https://store.example.net:8443/a.zip', true],
    ['https://bucket.example.com:8443/a.zip', false],
    ['https://store.example.net/a.zip', false],
    ['https://traces.example.org/a.zip', false],
    ['https://eviltraces.example.org/a.zip', false],
    ['https://bucket.example.com.evil.net/a.zip', false],
    ['https://example.com/a.zip', false]
  ])('%s is allowed: %s', (url, expected) => {
    expect(isAllowedHost(new URL(url), allowed)).toBe(expected)
  })

  it('allows nothing from an empty list', () => {
    expect(isAllowedHost(new URL('https://bucket.example.com/a.zip'), [])).toBe(
      false
    )
  })
})

type Answer = { error?: Error; addresses?: dns.LookupAddress[] }

function lookupFrom(answer: Answer) {
  return (
    _hostname: string,
    _options: dns.LookupAllOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      addresses: dns.LookupAddress[]
    ) => void
  ) => callback(answer.error ?? null, answer.addresses ?? [])
}

function resolve(
  answer: Answer,
  allowPrivate: boolean,
  all: boolean
): Promise<{ error: Error | null; result: unknown }> {
  return new Promise((done) => {
    guardedLookup(allowPrivate, lookupFrom(answer))(
      'host.example',
      { all } as dns.LookupOptions,
      (error: Error | null, address: unknown, family?: number) =>
        done({ error, result: all ? address : { address, family } })
    )
  })
}

describe('guardedLookup', () => {
  const PUBLIC = { address: '93.184.216.34', family: 4 }
  const PRIVATE = { address: '10.0.0.5', family: 4 }

  it('passes a public address through', async () => {
    expect(await resolve({ addresses: [PUBLIC] }, false, false)).toEqual({
      error: null,
      result: PUBLIC
    })
  })

  it('passes every address when asked for all', async () => {
    expect(await resolve({ addresses: [PUBLIC] }, false, true)).toEqual({
      error: null,
      result: [PUBLIC]
    })
  })

  it('refuses a host with any private address among its answers', async () => {
    const { error } = await resolve(
      { addresses: [PUBLIC, PRIVATE] },
      false,
      false
    )
    expect(error?.message).toBe(
      'host.example resolves to 10.0.0.5, a local or private address; set allowPrivateNetwork to fetch from it'
    )
  })

  it('allows a private address when the network is allowed', async () => {
    expect(await resolve({ addresses: [PRIVATE] }, true, false)).toEqual({
      error: null,
      result: PRIVATE
    })
  })

  it('passes a resolution error on', async () => {
    const failure = new Error('ENOTFOUND')
    expect((await resolve({ error: failure }, false, false)).error).toBe(
      failure
    )
  })
})
