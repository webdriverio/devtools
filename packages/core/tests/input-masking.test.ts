import { MASKED_VALUE, type CommandLog } from '@wdio/devtools-shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  captureMask,
  clearTypedValues,
  configureInputMasking,
  forgetTypedValuesBefore,
  maskCommandArgs,
  scrubTyped,
  scrubTypedBodies,
  scrubTypedRow,
  scrubTypedText,
  typedValuesMark
} from '../src/input-masking.js'

const ENTER = '\uE007'

beforeEach(() => {
  configureInputMasking()
  clearTypedValues()
})

describe('maskCommandArgs', () => {
  it('masks every argument of a WebdriverIO fill, keeping an options bag', () => {
    expect(
      maskCommandArgs('webdriverio', 'setValue', ['SuperSecretPassword!'])
    ).toEqual([MASKED_VALUE])
    expect(
      maskCommandArgs('webdriverio', 'addValue', [
        'tomsmith',
        { translateToUnicode: false }
      ])
    ).toEqual([MASKED_VALUE, { translateToUnicode: false }])
  })

  it('masks a number typed into a field', () => {
    expect(maskCommandArgs('webdriverio', 'setValue', [4242])).toEqual([
      MASKED_VALUE
    ])
  })

  it('keeps a key name pressed through keys(), and masks typed text there', () => {
    expect(maskCommandArgs('webdriverio', 'keys', ['Enter'])).toEqual(['Enter'])
    expect(
      maskCommandArgs('webdriverio', 'keys', [['Control', 'a', 'hunter2']])
    ).toEqual([['Control', MASKED_VALUE, MASKED_VALUE]])
  })

  it('masks the text of a protocol-level send keys, not the element id', () => {
    expect(
      maskCommandArgs('webdriverio', 'elementSendKeys', ['el-1', 'hunter2'])
    ).toEqual(['el-1', MASKED_VALUE])
  })

  it('masks key actions and keeps pointer actions', () => {
    const actions = [
      { type: 'key', id: 'k', actions: [{ type: 'keyDown', value: 'x' }] },
      { type: 'pointer', id: 'p', actions: [{ type: 'pointerMove', x: 1 }] }
    ]
    expect(maskCommandArgs('webdriverio', 'performActions', [actions])).toEqual(
      [
        [
          {
            type: 'key',
            id: 'k',
            actions: [
              { type: 'keyDown', value: MASKED_VALUE },
              { type: 'keyUp', value: MASKED_VALUE }
            ]
          },
          actions[1]
        ]
      ]
    )
  })

  it('collapses typed key actions to one press and remembers the text they spell', () => {
    const typing = [...'hunter2'].flatMap((ch) => [
      { type: 'keyDown', value: ch },
      { type: 'pause', duration: 10 },
      { type: 'keyUp', value: ch }
    ])
    const [sources] = maskCommandArgs('webdriverio', 'performActions', [
      [{ type: 'key', id: 'k', actions: typing }]
    ]) as [{ actions: unknown[] }[]]
    expect(sources[0].actions).toEqual([
      { type: 'keyDown', value: MASKED_VALUE },
      { type: 'keyUp', value: MASKED_VALUE }
    ])
    expect(scrubTypedText('hunter2')).toBe(MASKED_VALUE)
  })

  it('remembers no single character, so a chord does not mask every equal string', () => {
    maskCommandArgs('webdriverio', 'keys', [['Control', 'a']])
    maskCommandArgs('webdriverio', 'performActions', [
      [
        {
          type: 'key',
          id: 'k',
          actions: [
            { type: 'keyDown', value: '\uE009' },
            { type: 'keyDown', value: 'a' },
            { type: 'keyUp', value: 'a' },
            { type: 'keyUp', value: '\uE009' }
          ]
        }
      ]
    ])
    maskCommandArgs('selenium-webdriver', 'sendKeys', ['b'])
    expect(scrubTypedText('a')).toBe('a')
    expect(scrubTypedText('b')).toBe('b')
  })

  it('remembers what an array types as one string, not each element', () => {
    maskCommandArgs('webdriverio', 'setValue', [['hun', 'ter2']])
    expect(scrubTypedText('hunter2')).toBe(MASKED_VALUE)
    expect(scrubTypedText('hun')).toBe('hun')
  })

  it('masks text sent to a prompt', () => {
    expect(
      maskCommandArgs('webdriverio', 'sendAlertText', ['hunter2'])
    ).toEqual([MASKED_VALUE])
    expect(maskCommandArgs('nightwatch', 'setAlertText', ['hunter2'])).toEqual([
      MASKED_VALUE
    ])
  })

  it('masks every Selenium sendKeys argument, keeping its special keys', () => {
    expect(
      maskCommandArgs('selenium-webdriver', 'sendKeys', ['tomsmith', ENTER])
    ).toEqual([MASKED_VALUE, ENTER])
    expect(
      maskCommandArgs('selenium-webdriver', 'sendKeys', [`tom${ENTER}smith`])
    ).toEqual([`${MASKED_VALUE}${ENTER}${MASKED_VALUE}`])
  })

  it('masks the last data argument of a Nightwatch command, after the selector', () => {
    expect(
      maskCommandArgs('nightwatch', 'setValue', ['#password', 'hunter2'])
    ).toEqual(['#password', MASKED_VALUE])
    expect(
      maskCommandArgs('nightwatch', 'sendKeys', [
        'css selector',
        '#q',
        ['tom', ENTER]
      ])
    ).toEqual(['css selector', '#q', [MASKED_VALUE, ENTER]])
    expect(
      maskCommandArgs('nightwatch', 'setPassword', [
        '#p',
        'hunter2',
        '[Function]'
      ])
    ).toEqual(['#p', MASKED_VALUE, '[Function]'])
  })

  it('leaves a command that types nothing, and the selector of every command, as they are', () => {
    const args = ['#password']
    expect(maskCommandArgs('nightwatch', 'click', args)).toBe(args)
    expect(maskCommandArgs('webdriverio', 'getValue', [])).toEqual([])
  })

  it('does not change the arguments the command itself is called with', () => {
    const args = ['#password', 'hunter2']
    maskCommandArgs('nightwatch', 'setValue', args)
    expect(args).toEqual(['#password', 'hunter2'])
  })

  it('captures typed text verbatim with masking off', () => {
    configureInputMasking({ maskInputs: false })
    expect(captureMask().inputs).toBe(false)
    expect(
      maskCommandArgs('selenium-webdriver', 'sendKeys', ['hunter2'])
    ).toEqual(['hunter2'])
    expect(scrubTypedText('hunter2')).toBe('hunter2')
  })
})

describe('scrubbing what was typed', () => {
  beforeEach(() => {
    maskCommandArgs('webdriverio', 'setValue', ['S3cret pass'])
    maskCommandArgs('webdriverio', 'setValue', ['tom'])
  })

  it('masks a string equal to a typed value, however short', () => {
    expect(scrubTypedText('tom')).toBe(MASKED_VALUE)
    expect(scrubTypedText('S3cret pass')).toBe(MASKED_VALUE)
  })

  it('masks a long typed value inside text and leaves a short one', () => {
    expect(scrubTypedText('bottom: S3cret pass')).toBe(
      `bottom: ${MASKED_VALUE}`
    )
    expect(scrubTypedText('Welcome tom')).toBe('Welcome tom')
  })

  it('scrubs a value read back and an assertion operand, copying only what changed', () => {
    const untouched = { a: ['x'], b: 1 }
    expect(scrubTyped(untouched)).toBe(untouched)
    expect(scrubTyped({ actual: 'tom', nested: ['S3cret pass'] })).toEqual({
      actual: MASKED_VALUE,
      nested: [MASKED_VALUE]
    })
  })

  it('scrubs a row in place, so the dashboard and the trace see the same row', () => {
    const row: CommandLog = {
      command: 'assert.equal',
      args: ['tom', 'tom'],
      result: 'S3cret pass',
      error: { name: 'AssertionError', message: 'expected "S3cret pass"' },
      title: 'assert.equal("tom", "tom")',
      timestamp: 1
    }
    scrubTypedRow(row)
    expect(row.args).toEqual([MASKED_VALUE, MASKED_VALUE])
    expect(row.result).toBe(MASKED_VALUE)
    expect(row.error).toEqual({
      name: 'AssertionError',
      message: `expected "${MASKED_VALUE}"`
    })
    expect(row.title).toBe('assert.equal("tom", "tom")')
  })

  it('scrubs request bodies and leaves the url', () => {
    const request = {
      id: 'r',
      url: 'https://app.test/login',
      method: 'POST',
      timestamp: 1,
      startTime: 0,
      requestBody: 'password=S3cret+pass',
      responseBody: '{"user":"tom"}'
    }
    scrubTypedBodies(request)
    expect(request.requestBody).toBe(`password=${MASKED_VALUE}`)
    expect(request.responseBody).toBe('{"user":"tom"}')
  })

  it('keeps what was typed when the same policy is set again, and forgets it on a change', () => {
    configureInputMasking({ maskInputs: true })
    expect(scrubTypedText('tom')).toBe(MASKED_VALUE)
    configureInputMasking({ maskSelectors: ['.iban'] })
    expect(scrubTypedText('tom')).toBe('tom')
  })

  it('forgets only what was typed up to a mark', () => {
    const mark = typedValuesMark()
    maskCommandArgs('webdriverio', 'setValue', ['typed after'])
    forgetTypedValuesBefore(mark)
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
    expect(scrubTypedText('typed after')).toBe(MASKED_VALUE)
  })

  it('forgets what was typed at a test start', () => {
    clearTypedValues()
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
  })

  it('leaves a live object alone rather than walking or copying it', () => {
    class Element {
      text = 'S3cret pass'
    }
    const element = new Element()
    const scrubbed = scrubTyped({ element, plain: 'S3cret pass' })
    expect(scrubbed.element).toBe(element)
    expect(element.text).toBe('S3cret pass')
    expect(scrubbed.plain).toBe(MASKED_VALUE)
  })

  it('bounds the walk of a huge result', () => {
    const huge = Array.from({ length: 50_000 }, () => 'S3cret pass')
    const scrubbed = scrubTyped(huge)
    expect(scrubbed[0]).toBe(MASKED_VALUE)
    expect(scrubbed[49_999]).toBe('S3cret pass')
  })
})

// The row gets a masked copy; the driver must still receive what the test typed.
describe('maskCommandArgs leaves the arguments the driver sends untouched', () => {
  it.each([
    ['webdriverio', 'setValue', ['hunter2']],
    ['webdriverio', 'keys', [['h', 'i', 'Enter']]],
    [
      'webdriverio',
      'performActions',
      [[{ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: 'h' }] }]]
    ],
    ['selenium-webdriver', 'sendKeys', ['hunter2']],
    ['nightwatch', 'setValue', ['#password', 'hunter2']],
    [
      'webdriver',
      'sendKeysToElement',
      [{ text: 'hunter2', value: ['h', 'u', 'n', 't', 'e', 'r', '2'] }]
    ],
    [
      'webdriver',
      'w3cActions',
      [
        {
          actions: [
            { type: 'key', id: 'k', actions: [{ type: 'keyDown', value: 'h' }] }
          ]
        }
      ]
    ]
  ] as const)('%s %s', (vocabulary, command, args) => {
    const sent = structuredClone(args) as unknown[]
    const before = structuredClone(sent)

    maskCommandArgs(vocabulary, command, sent)

    expect(sent).toEqual(before)
  })
})
