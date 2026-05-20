import { describe, it, expect, vi } from 'vitest'
import { TraceRecorder } from '../src/recorder.js'
import type { BeforeActionEvent, AfterActionEvent } from '../src/types.js'

function makeBrowser(overrides: Partial<any> = {}): any {
  return {
    sessionId: 'abc12345',
    capabilities: { browserName: 'chrome' },
    isBidi: false,
    takeScreenshot: vi
      .fn()
      .mockResolvedValue(Buffer.from('fake').toString('base64')),
    on: vi.fn(),
    ...overrides
  }
}

describe('TraceRecorder', () => {
  it('initializes session on start()', () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()
    expect(recorder.session.sessionId).toBe('abc12345')
    expect(recorder.session.events[0].type).toBe('context-options')
  })

  it('unmapped commands produce no trace events', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()
    await recorder.wrapAction('takeScreenshot', [], undefined, async () => {})
    expect(recorder.session.events).toHaveLength(1) // only context-options
  })

  it('wrapAction pairs before/after with matching callId', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()

    await recorder.wrapAction(
      'url',
      ['https://example.com'],
      undefined,
      async () => {}
    )

    const beforeEvt = recorder.session.events.find(
      (e): e is BeforeActionEvent => e.type === 'before'
    )
    const afterEvt = recorder.session.events.find(
      (e): e is AfterActionEvent => e.type === 'after'
    )
    expect(beforeEvt).toBeDefined()
    expect(afterEvt).toBeDefined()
    expect(beforeEvt!.callId).toBe(afterEvt!.callId)
  })

  it('wrapAction emits after event even when invoke throws', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()

    await expect(
      recorder.wrapAction(
        'url',
        ['https://example.com'],
        undefined,
        async () => {
          throw new Error('navigation failed')
        }
      )
    ).rejects.toThrow('navigation failed')

    const beforeEvt = recorder.session.events.find(
      (e): e is BeforeActionEvent => e.type === 'before'
    )
    const afterEvt = recorder.session.events.find(
      (e): e is AfterActionEvent => e.type === 'after'
    )
    expect(beforeEvt).toBeDefined()
    expect(afterEvt).toBeDefined()
    expect(afterEvt!.error?.message).toBe('navigation failed')
  })

  it('element selector appears in before event params', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()

    await recorder.wrapAction('click', [], '#submit', async () => {})

    const beforeEvt = recorder.session.events.find(
      (e): e is BeforeActionEvent => e.type === 'before'
    )
    expect(beforeEvt?.params.selector).toBe('#submit')
  })

  it('non-string selector is omitted from before event params', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()

    await recorder.wrapAction('click', [], undefined, async () => {})

    const beforeEvt = recorder.session.events.find(
      (e): e is BeforeActionEvent => e.type === 'before'
    )
    expect(beforeEvt?.params).not.toHaveProperty('selector')
  })

  it('onReload updates pageId and contextId', () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()

    recorder.onReload('newSession99')
    expect(recorder.session.pageId).toBe('page@newSessi')
    expect(recorder.session.sessionId).toBe('newSession99')
  })

  it('stop() returns a Buffer', async () => {
    const browser = makeBrowser()
    const recorder = new TraceRecorder(browser)
    recorder.start()
    const result = await recorder.stop()
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })
})
