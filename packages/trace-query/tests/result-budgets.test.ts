import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { traceActionDetail } from '../src/action-detail.js'
import { traceActions } from '../src/action-list.js'
import { traceSummary } from '../src/summary.js'
import { openWritten } from './traces.js'

const START = 1_700_000_000_000
const SPEC = '/project/specs/budget.e2e.ts'
const SOURCE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')

function row(
  command: string,
  startOffset: number,
  endOffset: number,
  extra: Partial<CommandLog> = {}
): CommandLog {
  return {
    command,
    args: [],
    startTime: START + startOffset,
    timestamp: START + endOffset,
    ...extra
  }
}

const size = (value: unknown) => JSON.stringify(value).length

describe('results within their budget', () => {
  it('sheds a wait’s rows so every page of actions fits a small budget', async () => {
    const polls = Array.from({ length: 25 }, (_, i) =>
      row('getText', 110 + i * 10, 115 + i * 10, {
        parentId: 1,
        args: [`#field-${i}`]
      })
    )
    const handle = await openWritten({
      commands: [row('waitUntil', 100, 900, { id: 1 }), ...polls],
      startTime: START
    })
    for (const maxChars of [400, 700, 1_000]) {
      const page = traceActions(handle, { maxChars })
      expect(size(page)).toBeLessThanOrEqual(maxChars)
      expect(page.items[0]!.omittedChildren).toBeGreaterThan(5)
    }
  })

  it('cuts the first error, then leaves the tree out, so a summary fits its budget', async () => {
    const handle = await openWritten({
      commands: [
        row('click', 100, 200, {
          testUid: 'fails',
          error: { name: 'Error', message: `boom ${'x'.repeat(2_000)}` }
        })
      ],
      startTime: START
    })
    const whole = size(traceSummary(handle))
    for (const maxChars of [whole - 100, whole - 250]) {
      const summary = traceSummary(handle, { maxChars })
      expect(size(summary)).toBeLessThanOrEqual(maxChars)
      expect(summary.firstError?.message.startsWith('boom')).toBe(true)
    }
  })

  it('drops the call’s own source line before cutting any value', async () => {
    const handle = await openWritten({
      commands: [
        row('setValue', 100, 200, {
          args: ['#field', 'v'.repeat(400)],
          callSource: `${SPEC}:5`
        })
      ],
      sources: { [SPEC]: SOURCE },
      startTime: START
    })
    const { callId } = traceActions(handle).items[0]!
    const whole = traceActionDetail(handle, callId, { contextLines: 0 })
    expect(whole.source).toHaveLength(1)
    const { source: _source, ...withoutSource } = whole
    const detail = traceActionDetail(handle, callId, {
      contextLines: 0,
      maxChars: size(withoutSource)
    })
    expect(detail.source).toBeUndefined()
    expect(detail.args).toEqual(whole.args)
  })
})
