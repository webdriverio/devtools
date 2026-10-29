import { describe, expect, it } from 'vitest'

import {
  collapsedAssertResult,
  commandFailure,
  effectiveFailure,
  retriedRows
} from '../src/command-failure.js'
import { mapCommandToAction } from '../src/action-mapping.js'
import type { CommandLog } from '../src/types.js'

const row = (command: string, extra: Partial<CommandLog> = {}): CommandLog =>
  ({ command, args: [], timestamp: 1, ...extra }) as CommandLog

const failureOf = (r: CommandLog) =>
  commandFailure(r, mapCommandToAction(r.command)!)

describe('collapsedAssertResult', () => {
  it('reads a result carrying `passed`, and nothing else', () => {
    expect(collapsedAssertResult({ passed: false, actual: 1 })).toEqual({
      passed: false,
      actual: 1
    })
    expect(collapsedAssertResult('passed')).toBeUndefined()
    expect(collapsedAssertResult(null)).toBeUndefined()
  })
})

describe('commandFailure', () => {
  it('reads a row with an error as failed, with its message', () => {
    const error = { name: 'Error', message: 'boom' }
    expect(failureOf(row('click', { error }))).toEqual({ message: 'boom' })
  })

  it('reads a collapsed `passed: false` as failed, on any class', () => {
    expect(
      failureOf(row('assert.equal', { result: { passed: false } }))
    ).toEqual({ message: 'Assertion failed' })
    expect(
      failureOf(
        row('getText', { result: { passed: false, message: 'mismatch' } })
      )
    ).toEqual({ message: 'mismatch' })
  })

  it('reads a wait that resolved false as a timeout, and a read of false as a value', () => {
    expect(
      failureOf(
        row('waitForElementPresent', { args: ['#missing', 300], result: false })
      )
    ).toEqual({
      message: 'waitForElementPresent timed out waiting for #missing'
    })
    expect(failureOf(row('isDisplayed', { result: false }))).toBeUndefined()
  })

  it('reads a passing row as not failed', () => {
    expect(
      failureOf(row('assert.equal', { result: { passed: true } }))
    ).toBeUndefined()
    expect(failureOf(row('click', { result: null }))).toBeUndefined()
  })
})

describe('retriedRows', () => {
  const timedOut = { name: 'Error', message: 'timed out' }
  const noSuchElement = { name: 'Error', message: 'no such element' }
  const wait = (id: number, extra: Partial<CommandLog> = {}) =>
    row('waitUntil', { id, ...extra })
  const read = (parentId: number, extra: Partial<CommandLog> = {}) =>
    row('getText', { parentId, error: noSuchElement, ...extra })

  it('excuses a failed poll under a wait that passed, and only the failed one', () => {
    const passed = wait(1, { result: true })
    const failedPoll = read(1)
    const okPoll = read(1, { error: undefined })
    const retried = retriedRows([passed, failedPoll, okPoll])

    expect([...retried]).toEqual([failedPoll])
    expect(effectiveFailure(failedPoll, retried)).toBeUndefined()
    expect(effectiveFailure(passed, retried)).toBeUndefined()
  })

  it('keeps a poll failed under a wait that timed out, so the last one explains it', () => {
    const failed = wait(1, { error: timedOut })
    const poll = read(1)
    const retried = retriedRows([failed, poll])

    expect(retried.size).toBe(0)
    expect(effectiveFailure(poll, retried)).toEqual({
      message: 'no such element'
    })
    expect(effectiveFailure(failed, retried)).toEqual({ message: 'timed out' })
  })

  it('excuses every failure at any depth under a wait that passed, a failed inner wait included', () => {
    const outer = wait(1, { result: true })
    const inner = wait(2, { parentId: 1, error: timedOut })
    const poll = read(2)
    expect([...retriedRows([outer, inner, poll])]).toEqual([inner, poll])
  })

  it('judges a wait still running as not failed, so its polls wait on its outcome', () => {
    const running = wait(1)
    const poll = read(1)
    expect([...retriedRows([running, poll])]).toEqual([poll])
  })

  it('judges a parent the vocabulary does not map by its error alone', () => {
    const unmapped = row('findElements', { id: 1, error: timedOut })
    expect(retriedRows([unmapped, read(1)]).size).toBe(0)
  })
})
