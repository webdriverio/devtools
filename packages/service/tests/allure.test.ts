import { describe, it, expect, vi, beforeEach } from 'vitest'

const addAttachment = vi.fn()
vi.mock('@wdio/allure-reporter', () => ({
  addAttachment,
  default: { addAttachment }
}))

import { getAllureSink, resetAllureSinkCache } from '../src/allure.js'

describe('getAllureSink', () => {
  beforeEach(() => {
    addAttachment.mockReset()
    resetAllureSinkCache()
  })

  it('resolves a sink that forwards to @wdio/allure-reporter.addAttachment', async () => {
    const sink = await getAllureSink()
    expect(sink).toBeTypeOf('function')
    const content = Buffer.from('zip-bytes')
    await sink!('trace-abc.zip', content, 'application/zip')
    expect(addAttachment).toHaveBeenCalledOnce()
    expect(addAttachment).toHaveBeenCalledWith(
      'trace-abc.zip',
      content,
      'application/zip'
    )
  })

  it('memoizes the resolved sink across calls (single reporter probe)', async () => {
    const first = await getAllureSink()
    const second = await getAllureSink()
    expect(first).toBe(second)
  })
})
