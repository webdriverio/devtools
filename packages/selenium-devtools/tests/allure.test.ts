import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const attachment = vi.fn()
vi.mock('allure-js-commons', () => ({
  attachment,
  default: { attachment }
}))

import { getAllureSink, resetAllureSinkCache } from '../src/allure.js'

type GlobalWithRuntime = { allureTestRuntime?: unknown }

function clearRuntime() {
  delete (globalThis as GlobalWithRuntime).allureTestRuntime
}

describe('getAllureSink (selenium)', () => {
  beforeEach(() => {
    attachment.mockReset()
    resetAllureSinkCache()
    clearRuntime()
  })

  afterEach(clearRuntime)

  it('resolves a sink that forwards to allure-js-commons.attachment when Allure is active', async () => {
    ;(globalThis as GlobalWithRuntime).allureTestRuntime = {}
    const sink = await getAllureSink()
    expect(sink).toBeTypeOf('function')
    const content = Buffer.from('zip-bytes')
    await sink!('trace-abc.zip', content, 'application/zip')
    expect(attachment).toHaveBeenCalledOnce()
    expect(attachment).toHaveBeenCalledWith(
      'trace-abc.zip',
      content,
      'application/zip'
    )
  })

  it('returns undefined (produce-only, no attachment call) when no Allure runtime is active', async () => {
    const sink = await getAllureSink()
    expect(sink).toBeUndefined()
    expect(attachment).not.toHaveBeenCalled()
  })

  it('memoizes the resolved sink across calls', async () => {
    ;(globalThis as GlobalWithRuntime).allureTestRuntime = {}
    const first = await getAllureSink()
    const second = await getAllureSink()
    expect(first).toBe(second)
  })
})
