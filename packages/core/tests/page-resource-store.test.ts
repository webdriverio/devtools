import { PAGE_RESOURCE_SETTLE_TIMEOUT_MS } from '@wdio/devtools-shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageResourceStore } from '../src/page-resource-store.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('PageResourceStore.configure', () => {
  it('stores styles by default in trace mode and nothing in live mode', () => {
    const store = new PageResourceStore()
    store.configure({ mode: 'trace' })
    expect(store.mode).toBe('styles')
    store.configure({ mode: 'trace', traceResources: 'none' })
    expect(store.mode).toBe('none')
    store.configure({ mode: 'live', traceResources: 'styles' })
    expect(store.mode).toBe('none')
  })
})

describe('PageResourceStore.settle', () => {
  it('drains again until the page reports no read in flight', async () => {
    vi.useFakeTimers()
    const store = new PageResourceStore()
    store.mode = 'styles'
    store.pending = 2
    const drain = vi.fn(async () => {
      store.ingest({ pendingResources: drain.mock.calls.length === 1 ? 1 : 0 })
    })

    const settled = store.settle(drain)
    await vi.runAllTimersAsync()
    await settled

    expect(drain).toHaveBeenCalledTimes(2)
  })

  it('gives up at its deadline on a page that never finishes', async () => {
    vi.useFakeTimers()
    const store = new PageResourceStore()
    store.mode = 'styles'
    store.pending = 1
    const drain = vi.fn(async () => store.ingest({ pendingResources: 1 }))

    const settled = store.settle(drain)
    await vi.advanceTimersByTimeAsync(PAGE_RESOURCE_SETTLE_TIMEOUT_MS + 500)
    await settled

    expect(drain.mock.calls.length).toBeGreaterThan(0)
    expect(drain.mock.calls.length).toBeLessThan(30)
  })

  it('stops when a drain reaches no collector', async () => {
    vi.useFakeTimers()
    const store = new PageResourceStore()
    store.mode = 'styles'
    store.pending = 3
    const drain = vi.fn(async () => undefined)

    const settled = store.settle(drain)
    await vi.runAllTimersAsync()
    await settled

    expect(drain).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a run that stores no resources', async () => {
    const store = new PageResourceStore()
    store.pending = 3
    const drain = vi.fn(async () => undefined)
    await store.settle(drain)
    expect(drain).not.toHaveBeenCalled()
  })
})
