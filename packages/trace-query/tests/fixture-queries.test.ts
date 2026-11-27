// Every query over a real zip from each adapter's writer, older formats included.

import { describe, expect, it } from 'vitest'
import { traceActionDetail } from '../src/action-detail.js'
import { traceActions } from '../src/action-list.js'
import { traceErrors } from '../src/errors.js'
import { traceStateOf } from '../src/open-trace.js'
import { DEFAULT_MAX_CHARS } from '../src/constants.js'
import { traceSummary } from '../src/summary.js'
import { traceTranscript } from '../src/transcript.js'
import type { ActionRow, TestNode } from '../src/types.js'
import { fixtures, openFixture } from './traces.js'

function flatten(rows: readonly ActionRow[]): ActionRow[] {
  return rows.flatMap((row) => [row, ...flatten(row.children ?? [])])
}

function leaves(nodes: readonly TestNode[]): TestNode[] {
  return nodes.flatMap((node) =>
    node.children ? leaves(node.children) : [node]
  )
}

describe.each(fixtures)('queries over $zipName', ({ zipName, manifest }) => {
  it('summarizes the runner, browser and failures the zip records', async () => {
    const summary = traceSummary(await openFixture(zipName))
    const failed = manifest.commands.failed
    expect(summary).toMatchObject({
      runner: manifest.runner,
      browser: manifest.browserName,
      outcome: failed ? 'failed' : 'passed'
    })
    expect(summary.counts.failedActions).toBe(failed)
    expect(summary.firstError?.kind).toBe(failed ? 'action' : undefined)
    expect(leaves(summary.tests ?? []).length).toBeGreaterThan(0)
  })

  it('lists the errors by time, each naming an action the trace holds', async () => {
    const handle = await openFixture(zipName)
    const { items, total } = traceErrors(handle)
    expect(items).toHaveLength(total)
    expect(items.map((error) => error.timeMs)).toEqual(
      items.map((error) => error.timeMs).sort((a, b) => a - b)
    )
    for (const error of items.filter((item) => item.callId)) {
      expect(() => traceActionDetail(handle, error.callId!)).not.toThrow()
    }
    const failedRows = items.filter((error) => error.kind === 'action')
    expect(failedRows).toHaveLength(manifest.commands.failed)
    for (const error of failedRows) {
      expect(traceActionDetail(handle, error.callId!).status).toBe('failed')
    }
  })

  it('lists every action once, in the order they started', async () => {
    const handle = await openFixture(zipName)
    const { items, total, nextCursor } = traceActions(handle)
    const rows = flatten(items)
    expect(nextCursor).toBeUndefined()
    expect(total).toBe(traceSummary(handle).counts.actions)
    expect(rows).toHaveLength(manifest.commands.count)
    expect(new Set(rows.map((row) => row.callId)).size).toBe(rows.length)
    expect(items.map((row) => row.startMs)).toEqual(
      items.map((row) => row.startMs).sort((a, b) => a - b)
    )
    expect(rows.filter((row) => row.status === 'failed')).toHaveLength(
      manifest.commands.failed
    )
  })

  it('details every action, with the source around its call site', async () => {
    const handle = await openFixture(zipName)
    const details = flatten(traceActions(handle).items).map((row) => {
      const detail = traceActionDetail(handle, row.callId)
      expect(detail).toMatchObject({ callId: row.callId, startMs: row.startMs })
      expect(JSON.stringify(detail).length).toBeLessThanOrEqual(
        DEFAULT_MAX_CHARS
      )
      return detail
    })
    const withSource = details.filter((detail) => detail.source)
    expect(withSource.length).toBeGreaterThan(0)
    for (const { source } of withSource) {
      expect(source!.filter((line) => line.startsWith('>'))).toHaveLength(1)
    }
  })

  it('lists only the actions of the test it is asked for', async () => {
    const handle = await openFixture(zipName)
    for (const test of leaves(traceSummary(handle).tests ?? [])) {
      for (const row of traceActions(handle, { group: test.callId }).items) {
        expect(traceActionDetail(handle, row.callId).test?.slice(-1)).toEqual([
          test.title
        ])
      }
    }
  })

  it('returns the transcript the zip carries', async () => {
    const handle = await openFixture(zipName)
    const transcript = traceTranscript(handle)
    expect(transcript?.items.join('\n')).toBe(
      traceStateOf(handle).data.transcript
    )
    expect(Boolean(transcript)).toBe(manifest.transcript)
  })
})
