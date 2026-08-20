import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COLLECTOR_MUTATION_CHANNEL,
  COLLECTOR_SINK_GLOBAL
} from '@wdio/devtools-shared'
import { registerCollectorPreload } from '../src/bidi-preload.js'

const loadSeleniumSubmodule = vi.hoisted(() => vi.fn())
const loadCollectorSource = vi.hoisted(() =>
  vi.fn(async () => 'COLLECTOR_SOURCE')
)

vi.mock('../src/bidi.js', () => ({ loadSeleniumSubmodule }))
vi.mock('../src/script-loader.js', () => ({ loadCollectorSource }))

/** Stand-in for `selenium-webdriver/bidi/protocolValue`. `addPreloadScript`
 *  calls `.asMap()` on every argument, so the channel cannot be a bare object —
 *  these are the two classes that produce one that can. */
const protocolValue = {
  LocalValue: {
    createChannelValue: (channel: unknown) => ({
      kind: 'channel',
      channel,
      asMap: () => ({})
    })
  },
  ChannelValue: class {
    constructor(public channel: string) {}
  }
}

type Registered = { declaration: string; args: unknown[] }

function makeManager() {
  const registered: Registered[] = []
  let handler: ((message: unknown) => void) | undefined
  return {
    registered,
    emit: (message: unknown) => handler?.(message),
    get subscribed() {
      return handler !== undefined
    },
    manager: {
      addPreloadScript: vi.fn(
        async (declaration: string, args: unknown[] = []) => {
          registered.push({ declaration, args })
          return 1
        }
      ),
      onMessage: vi.fn(async (cb: (message: unknown) => void) => {
        handler = cb
      })
    }
  }
}

function withSubmodules(manager: unknown, values: unknown = protocolValue) {
  loadSeleniumSubmodule.mockImplementation((subpath: string) => {
    if (subpath === 'bidi/scriptManager') {
      return async () => manager
    }
    if (subpath === 'bidi/protocolValue') {
      return values
    }
    return null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  loadCollectorSource.mockResolvedValue('COLLECTOR_SOURCE')
})

describe('registerCollectorPreload without a sink', () => {
  it('registers the bare collector and never subscribes', async () => {
    const harness = makeManager()
    withSubmodules(harness.manager)

    expect(await registerCollectorPreload({})).toBe(true)
    expect(harness.subscribed).toBe(false)
    expect(harness.registered[0].args).toEqual([])
    expect(harness.registered[0].declaration).not.toContain(
      COLLECTOR_SINK_GLOBAL
    )
  })
})

describe('registerCollectorPreload with a sink', () => {
  it('parks the emit function on the global before the source runs', async () => {
    // The collector claims the sink in its own module body, which the bundle
    // evaluates before it anchors the document — so the assignment has to come
    // first in the declaration, not after the source.
    const harness = makeManager()
    withSubmodules(harness.manager)

    await registerCollectorPreload({}, undefined, () => {})

    const { declaration, args } = harness.registered[0]
    expect(declaration).toContain(COLLECTOR_SINK_GLOBAL)
    expect(declaration.indexOf(COLLECTOR_SINK_GLOBAL)).toBeLessThan(
      declaration.indexOf('COLLECTOR_SOURCE')
    )
    expect(args).toHaveLength(1)
  })

  it('parses a pushed payload and forwards the mutations', async () => {
    const harness = makeManager()
    withSubmodules(harness.manager)
    const onMutations = vi.fn()

    await registerCollectorPreload({}, undefined, onMutations)
    harness.emit({
      channel: COLLECTOR_MUTATION_CHANNEL,
      data: { value: JSON.stringify([{ type: 'childList' }]) }
    })

    expect(onMutations).toHaveBeenCalledWith([{ type: 'childList' }])
  })

  it('ignores messages on another channel', async () => {
    // Every subscriber on the session sees every script.message.
    const harness = makeManager()
    withSubmodules(harness.manager)
    const onMutations = vi.fn()

    await registerCollectorPreload({}, undefined, onMutations)
    harness.emit({
      channel: 'someone-elses-channel',
      data: { value: JSON.stringify([{ type: 'childList' }]) }
    })

    expect(onMutations).not.toHaveBeenCalled()
  })

  it('ignores an empty batch and a non-string payload', async () => {
    const harness = makeManager()
    withSubmodules(harness.manager)
    const onMutations = vi.fn()

    await registerCollectorPreload({}, undefined, onMutations)
    harness.emit({
      channel: COLLECTOR_MUTATION_CHANNEL,
      data: { value: JSON.stringify([]) }
    })
    harness.emit({
      channel: COLLECTOR_MUTATION_CHANNEL,
      data: { value: { not: 'a string' } }
    })

    expect(onMutations).not.toHaveBeenCalled()
  })

  it('survives an unparseable payload', async () => {
    const harness = makeManager()
    withSubmodules(harness.manager)
    const onMutations = vi.fn()
    const log = vi.fn()

    await registerCollectorPreload({}, log, onMutations)
    expect(() =>
      harness.emit({
        channel: COLLECTOR_MUTATION_CHANNEL,
        data: { value: '{ not json' }
      })
    ).not.toThrow()
    expect(onMutations).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('payload'))
  })
})

describe('registerCollectorPreload degradation', () => {
  it('still registers the preload when the channel classes are missing', async () => {
    // Losing the push costs round trips; losing the preload would bring back
    // the whole race class it exists to remove. The preload wins.
    const harness = makeManager()
    withSubmodules(harness.manager, null)

    expect(await registerCollectorPreload({}, undefined, () => {})).toBe(true)
    expect(harness.registered[0].args).toEqual([])
    expect(harness.registered[0].declaration).not.toContain(
      COLLECTOR_SINK_GLOBAL
    )
  })

  it('still registers the preload when subscribing throws', async () => {
    const harness = makeManager()
    harness.manager.onMessage.mockRejectedValue(new Error('no subscribe'))
    withSubmodules(harness.manager)
    const log = vi.fn()

    expect(await registerCollectorPreload({}, log, () => {})).toBe(true)
    expect(harness.registered[0].args).toEqual([])
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('falling back to draining')
    )
  })

  it('returns false when selenium has no script manager at all', async () => {
    loadSeleniumSubmodule.mockReturnValue(null)
    expect(await registerCollectorPreload({}, undefined, () => {})).toBe(false)
  })
})
