import { describe, expect, it } from 'vitest'

import {
  collapsedAssertResult,
  commandFailure
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
