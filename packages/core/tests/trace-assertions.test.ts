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

  it('marks a non-assert command whose result reports passed:false as failed', () => {
    // Nightwatch's waitForElement* commands carry no Error, only the collapsed
    // result, and they map to `Element` — so gating the collapsed-failure read on
    // the assert class left the step a test most often fails on rendered green,
    // with the timeout readable only in the result pane.
    const commands: CommandLog[] = [
      {
        command: 'waitForElementVisible',
        args: ['a*=Logout', 5000],
        result: {
          passed: false,
          expected: 'visible',
          actual: 'not found',
          message: 'Timed out while waiting for element <a*=Logout>'
        },
        startTime: WALL + 10,
        timestamp: WALL + 5010
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [row] = befores(events)
    expect(row.apiName).toBe('element.waitForDisplayed')
    expect(afterOf(events, row.callId)?.error?.message).toContain('Timed out')
  })

  it('falls back to a command-named message when the result carries none', () => {
    const commands: CommandLog[] = [
      {
        command: 'waitForElementPresent',
        args: ['#gone'],
        result: { passed: false },
        timestamp: WALL + 20
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [row] = befores(events)
    expect(afterOf(events, row.callId)?.error?.message).toBe(
      'waitForElementPresent failed'
    )
  })

  it('marks a wait that resolved false as timed out', () => {
    // Nightwatch reports waitForElement* timeouts through its own assertion
    // channel, not the command callback — which hands back {value: null} and
    // collapses to plain false. That boolean is the row's only evidence.
    const commands: CommandLog[] = [
      {
        command: 'waitForElementVisible',
        args: ['a*=Logout', 5000],
        result: false,
        startTime: WALL + 10,
        timestamp: WALL + 5010
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [row] = befores(events)
    expect(afterOf(events, row.callId)?.error?.message).toBe(
      'waitForElementVisible timed out waiting for a*=Logout'
    )
  })

  it('does not read false as a failure for a non-wait command', () => {
    // `false` is a legitimate value for a boolean read.
    const commands: CommandLog[] = [
      {
        command: 'isDisplayed',
        args: ['#hidden'],
        result: false,
        timestamp: WALL + 40
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [row] = befores(events)
    expect(afterOf(events, row.callId)?.error).toBeUndefined()
  })

  it('leaves a passing wait without an error', () => {
    const commands: CommandLog[] = [
      {
        command: 'waitForElementVisible',
        args: ['#username'],
        result: true,
        timestamp: WALL + 30
      }
    ]
    const events = buildActionEvents(commands, 'page@1', WALL)
    const [row] = befores(events)
    expect(afterOf(events, row.callId)?.error).toBeUndefined()
  })

  it('orders an issued-earlier assert before a longer command sharing its start', () => {
    // Nightwatch enqueues `browser.assert.*` synchronously and then awaits the
    // next command, so both read the same millisecond `startTime`. The assert is
    // appended to commandsLog in the test-end batch, i.e. AFTER the click, so
    // without `sequence` the tie resolved in insertion order and the assert
    // landed below the logout click it actually preceded.
    const commands: CommandLog[] = [
      {
        command: 'click',
        args: ['a*=Logout'],
        startTime: WALL + 100,
        timestamp: WALL + 5100,
        sequence: 3
      },
      {
        command: 'assert.urlContains',
        args: ['/secure'],
        result: 'passed',
        startTime: WALL + 100,
        timestamp: WALL + 100,
        sequence: 1
      },
      {
        command: 'assert.textContains',
        args: ['#flash', 'You logged into a secure area'],
        result: 'passed',
        startTime: WALL + 100,
        timestamp: WALL + 100,
        sequence: 2
      }
    ]
    const order = befores(buildActionEvents(commands, 'page@1', WALL)).map(
      (b) => b.apiName
    )
    expect(order).toEqual([
      'assert.urlContains',
      'assert.textContains',
      'element.click'
    ])
  })

  it('falls back to insertion order when no sequence is stamped', () => {
    const commands: CommandLog[] = [
      { command: 'click', args: ['#a'], startTime: WALL, timestamp: WALL },
      { command: 'click', args: ['#b'], startTime: WALL, timestamp: WALL }
    ]
    const order = befores(buildActionEvents(commands, 'page@1', WALL)).map(
      (b) => b.title
    )
    expect(order).toEqual(order.slice().sort())
    expect(order[0]).toContain('#a')
    expect(order[1]).toContain('#b')
  })

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
