import { describe, expect, it } from 'vitest'

import { FIELD_TYPE_SCRIPT } from '../src/page-scripts.js'
import {
  isPasswordFieldType,
  isRedactableValue,
  redactsTypedText,
  typedText
} from '../src/typed-secrets.js'

interface FakeField {
  type: string
}

/** Runs the script as WebDriver's execute/sync would, against a page whose selectors resolve to the given fields, first match first. */
function fieldType(
  args: unknown[],
  css: Record<string, FakeField[]>,
  xpath: Record<string, FakeField[]> = {}
): unknown {
  const document = {
    querySelector: (sel: string) => {
      if (sel.startsWith('/')) {
        throw new SyntaxError('not a CSS selector')
      }
      return css[sel]?.[0] ?? null
    },
    evaluate: (sel: string) => ({ singleNodeValue: xpath[sel]?.[0] ?? null }),
    activeElement: { type: 'password' }
  }

  const run = new Function(
    'document',
    `return (function(){${FIELD_TYPE_SCRIPT}}).apply(null, arguments[1])`
  )
  return run(document, args)
}

describe('typed secrets', () => {
  it('joins typed parts and drops special keys', () => {
    expect(typedText(['pass', 'word', '', 1])).toBe('password1')
    expect(typedText(undefined)).toBe('')
  })

  it('applies the secrets length rule', () => {
    expect(isRedactableValue('abcd')).toBe(true)
    expect(isRedactableValue(' abc ')).toBe(false)
  })

  it('reads a password type in any case', () => {
    expect(isPasswordFieldType('PASSWORD')).toBe(true)
    expect(isPasswordFieldType('text')).toBe(false)
    expect(isPasswordFieldType(null)).toBe(false)
  })

  it('redacts text typed into a password field or a field whose read did not answer', () => {
    expect(redactsTypedText('hunter22', 'password')).toBe(true)
    expect(redactsTypedText('hunter22', 'text')).toBe(false)
    expect(redactsTypedText('hunter22', null)).toBe(false)
    expect(redactsTypedText('hunter22', undefined, false)).toBe(true)
    expect(redactsTypedText('abc', undefined, false)).toBe(false)
  })
})

describe('FIELD_TYPE_SCRIPT', () => {
  const pw = { type: 'password' }
  const user = { type: 'text' }

  it('reads the first field the selector matches, by the strategy given', () => {
    expect(fieldType(['input', 'css'], { input: [user, pw] })).toBe('text')
    expect(fieldType(['//input[2]', 'xpath'], {}, { '//input[2]': [pw] })).toBe(
      'password'
    )
  })

  it('reads an empty type for a match that is not a form control', () => {
    expect(fieldType(['#hero', 'css'], { '#hero': [{}] })).toBe('')
  })

  it('reads nothing when the selector matches nothing, never the focused element', () => {
    expect(fieldType(['#gone', 'css'], {})).toBeNull()
    expect(fieldType([null, 'css'], {})).toBeNull()
    expect(fieldType(['//bad', 'css'], {})).toBeNull()
  })
})
