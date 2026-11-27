import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { actionKey, normalizeSelector } from '../src/action-key.js'

function command(fields: Partial<CommandLog>): CommandLog {
  return {
    command: 'click',
    args: [],
    result: undefined,
    timestamp: 0,
    callSource: '',
    ...fields
  }
}

describe('normalizeSelector', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSelector('  form   button\n.submit ')).toBe(
      'form button .submit'
    )
  })
})

describe('actionKey', () => {
  it('joins the command and its normalized selector', () => {
    expect(actionKey(command({ selector: ' #login \t button ' }))).toBe(
      'click #login button'
    )
  })

  it('is the command alone without a selector', () => {
    expect(actionKey(command({ command: 'url', selector: undefined }))).toBe(
      'url'
    )
  })

  it('is the command alone for an empty selector', () => {
    expect(actionKey(command({ selector: '' }))).toBe('click')
  })
})
