import { describe, it, expect } from 'vitest'
import {
  ASSERT_ACTION_CLASS,
  mapAssertCommand,
  type CommandLog
} from '@wdio/devtools-shared'
import { formatActionTitle, mapCommandToAction } from '../src/action-mapping.js'
import {
  buildActionEvents,
  type AfterEvent,
  type BeforeEvent
} from '../src/trace-action-events.js'

describe('mapAssertCommand', () => {
  it('maps assert./verify./expect. prefixed commands to the Assert class', () => {
    expect(mapAssertCommand('assert.strictEqual')).toEqual({
      class: ASSERT_ACTION_CLASS,
      method: 'strictEqual'
    })
    expect(mapAssertCommand('verify.visible')).toEqual({
      class: ASSERT_ACTION_CLASS,
      method: 'visible'
    })
    expect(mapAssertCommand('expect.toBe')).toEqual({
      class: ASSERT_ACTION_CLASS,
      method: 'toBe'
    })
  })

  it('returns null for anything else', () => {
    expect(mapAssertCommand('click')).toBeNull()
    expect(mapAssertCommand('url')).toBeNull()
    expect(mapAssertCommand('assertx.foo')).toBeNull()
    expect(mapAssertCommand('assert.')).toBeNull()
    expect(mapAssertCommand('assert.deep.equal')).toBeNull()
  })
})

describe('mapCommandToAction assert fallthrough', () => {
  it('keeps the ACTION_MAP lookup for runner commands', () => {
    expect(mapCommandToAction('url')).toEqual({
      class: 'Page',
      method: 'navigate'
    })
  })

  it('falls through to the assert mapping instead of filtering', () => {
    expect(mapCommandToAction('assert.ok')).toEqual({
      class: ASSERT_ACTION_CLASS,
      method: 'ok'
    })
    expect(mapCommandToAction('notACommand')).toBeNull()
  })
})

describe('formatActionTitle for asserts', () => {
  const action = { class: ASSERT_ACTION_CLASS, method: 'strictEqual' }

  it('renders the original command with quoted actual/expected', () => {
    expect(
      formatActionTitle(
        action,
        ['a', 'b', 'msg'],
        undefined,
        'assert.strictEqual'
      )
    ).toBe('assert.strictEqual("a", "b")')
  })

  it('labels from the call args, not the derived actual/expected', () => {
    // textContains('#el', 'foo') passes the selector + expected as args; the
    // real "actual" ('bar') lives in params for the result diff and must NOT
    // leak into the concise label, which mirrors the call the user wrote.
    expect(
      formatActionTitle(
        action,
        ['#el', 'foo'],
        { actual: 'bar', expected: 'foo' },
        'verify.textContains'
      )
    ).toBe('verify.textContains("#el", "foo")')
  })

  it('falls back to actual/expected params only when no args survive', () => {
    expect(
      formatActionTitle(
        action,
        [],
        { actual: 'bar', expected: 'foo' },
        'verify.textContains'
      )
    ).toBe('verify.textContains("bar", "foo")')
  })

  it('falls back to assert.<method> when no command is supplied', () => {
    expect(formatActionTitle(action, [1, 2])).toBe('assert.strictEqual(1, 2)')
  })

  it('truncates long values', () => {
    const long = 'x'.repeat(100)
    const title = formatActionTitle(action, [long], undefined, 'assert.ok')
    expect(title.length).toBeLessThan(60)
    expect(title.endsWith('…)')).toBe(true)
  })

  it('leaves non-assert titles unchanged', () => {
    expect(
      formatActionTitle({ class: 'Element', method: 'click' }, ['#go'])
    ).toBe('Element.click("#go")')
  })
})

describe('buildActionEvents with assert commands', () => {
  const WALL = 1_000_000

  const befores = (events: (BeforeEvent | AfterEvent)[]) =>
    events.filter((e): e is BeforeEvent => e.type === 'before')
  const afterOf = (events: (BeforeEvent | AfterEvent)[], callId: string) =>
    events.find(
      (e): e is AfterEvent => e.type === 'after' && e.callId === callId
    )

  it('emits an action pair with assert params, apiName and title', () => {
    const commands: CommandLog[] = [
      {
        command: 'assert.strictEqual',
        args: ['a', 'b', 'values differ'],
        timestamp: WALL + 200,
        startTime: WALL + 200,
        error: { name: 'AssertionError', message: 'a !== b' }
      },
      {
        command: 'assert.ok',
        args: [true],
        result: 'passed',
        timestamp: WALL + 300
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [failed, passed] = befores(events)

    expect(failed.class).toBe(ASSERT_ACTION_CLASS)
    expect(failed.method).toBe('strictEqual')
    expect(failed.apiName).toBe('assert.strictEqual')
    expect(failed.title).toBe('assert.strictEqual("a", "b")')
    expect(failed.params).toEqual({
      '0': 'a',
      '1': 'b',
      '2': 'values differ',
      actual: 'a',
      expected: 'b',
      message: 'values differ'
    })
    expect(afterOf(events, failed.callId)?.error).toEqual({
      message: 'a !== b'
    })

    expect(passed.apiName).toBe('assert.ok')
    expect(passed.params).toEqual({ '0': true, actual: true })
    expect(afterOf(events, passed.callId)?.error).toBeUndefined()
  })

  it('normalizes nightwatch collapsed assertion results', () => {
    const commands: CommandLog[] = [
      {
        command: 'verify.textContains',
        args: ['#el', 'foo'],
        result: {
          passed: false,
          actual: 'bar',
          expected: 'foo',
          message: 'nope'
        },
        timestamp: WALL + 100
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [before] = befores(events)
    expect(before.params).toMatchObject({
      '0': '#el',
      '1': 'foo',
      actual: 'bar',
      expected: 'foo',
      message: 'nope'
    })
    // Label mirrors the call args; actual/expected stay in params for the diff.
    expect(before.title).toBe('verify.textContains("#el", "foo")')
    // No Error instance on the entry — the failure comes from the collapsed result.
    expect(afterOf(events, before.callId)?.error).toEqual({ message: 'nope' })
  })

  it('keeps passing nightwatch asserts error-free and groups by testUid', () => {
    const commands: CommandLog[] = [
      {
        command: 'assert.visible',
        args: ['#el'],
        result: true,
        timestamp: WALL + 100,
        testUid: 't1'
      }
    ]
    const metadata = new Map([
      ['t1', { title: 'logs in', specFile: '/specs/login.ts' }]
    ])
    const events = buildActionEvents(commands, 'page@1', WALL, metadata)
    const [group, action] = befores(events)
    expect(group.method).toBe('tracingGroup')
    expect(group.title).toBe('logs in')
    expect(action.parentId).toBe(group.callId)
    expect(action.params).toEqual({ '0': '#el', actual: '#el' })
    expect(afterOf(events, action.callId)?.error).toBeUndefined()
  })
})
