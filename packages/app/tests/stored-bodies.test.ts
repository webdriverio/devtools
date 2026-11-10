// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { NetworkRequest } from '@wdio/devtools-shared'

import { StoredResponseBodies } from '../src/components/workbench/network/stored-bodies.js'
import type { PlayerArchive } from '../src/controller/context.js'
import { TraceEntries } from '../src/controller/trace-entries.js'

const request = (overrides: Partial<NetworkRequest> = {}): NetworkRequest =>
  ({
    id: '3',
    url: 'https://x.test/api',
    method: 'GET',
    timestamp: 1,
    ...overrides
  }) as NetworkRequest

function playerArchive(body = '{"a":1}') {
  const read = vi.fn(() => Promise.resolve(new Blob([body])))
  const entries = new TraceEntries()
  entries.attach({
    open: () => Promise.reject(new Error('unused')),
    read,
    close: () => {}
  })
  const archive: PlayerArchive = {
    entries,
    responseBodies: { '3': 'resources/b' }
  }
  return { archive, read }
}

describe('StoredResponseBodies', () => {
  it('reads a stored body when its request is opened, then shows it', async () => {
    const onLoad = vi.fn()
    const bodies = new StoredResponseBodies(onLoad)
    const { archive, read } = playerArchive()

    expect(bodies.withBody(request(), archive).responseBody).toBeUndefined()
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))

    expect(bodies.withBody(request(), archive).responseBody).toBe('{"a":1}')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads nothing for a request whose body is inline or not stored, or in live mode', () => {
    const bodies = new StoredResponseBodies(() => {})
    const { archive, read } = playerArchive()

    expect(
      bodies.withBody(request({ responseBody: 'inline' }), archive).responseBody
    ).toBe('inline')
    expect(
      bodies.withBody(request({ id: '9' }), archive).responseBody
    ).toBeUndefined()
    expect(bodies.withBody(request(), undefined).responseBody).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
})
