import { describe, expect, it } from 'vitest'

import {
  dashboardSocketSource,
  hostedPlayerCsp,
  playerCsp
} from '../src/player-csp.js'

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)

describe('playerCsp', () => {
  it('allows scripts and connections only from the player itself', () => {
    const policy = playerCsp()

    expect(directive(policy, 'script-src')).toBe("'self'")
    expect(directive(policy, 'connect-src')).toBe("'self'")
    expect(directive(policy, 'frame-ancestors')).toBe("'none'")
  })

  it('appends extra connection sources to connect-src alone', () => {
    const policy = playerCsp(['ws://localhost:3000'])

    expect(directive(policy, 'connect-src')).toBe("'self' ws://localhost:3000")
    expect(directive(policy, 'script-src')).toBe("'self'")
  })
})

describe('hostedPlayerCsp', () => {
  it('adds https to connect-src alone, for a zip `?trace=` names', () => {
    const policy = hostedPlayerCsp()

    expect(directive(policy, 'connect-src')).toBe("'self' https:")
    expect(policy).toBe(playerCsp(['https:']))
  })
})

describe('dashboardSocketSource', () => {
  it.each(['localhost:3000', '127.0.0.1:62952', 'devbox.local', '[::1]:3000'])(
    'allows the socket of host %s',
    (host) => {
      expect(dashboardSocketSource(host)).toEqual([`ws://${host}`])
    }
  )

  it.each([undefined, '', 'evil.com; script-src *', 'a b', 'host:3000/path'])(
    'reflects nothing for %j',
    (host) => {
      expect(dashboardSocketSource(host)).toEqual([])
    }
  )
})
