import { MASKED_VALUE } from '@wdio/devtools-shared'

import {
  MASK_DECLARATION,
  MASK_INPUTS_OFF,
  PASSWORD_FIELDS
} from './constants.js'
import type { TypedText } from './types.js'

function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args)
  } catch {
    return args
  }
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  return Array.isArray(value) ? value.flatMap(stringsIn) : []
}

/** What the fake page's collector does with typed text: masks a password field unless its source declares otherwise, as `packages/script` does. */
export class FakeMaskPolicy {
  #maskInputs = true
  readonly typed: TypedText[] = []
  undeclared = 0

  /** `args` is the script's JSON-encoded arguments, decoded so a source passed as one reads as written. */
  noteSource(script: string, args = '[]'): void {
    const source = [script, ...stringsIn(parseArgs(args))].join('\n')
    if (!source.includes(MASK_DECLARATION)) {
      this.undeclared++
    }
    this.#maskInputs = !source.includes(MASK_INPUTS_OFF)
  }

  /** Records what `selector` received and returns the value its `value` mutation reports. */
  type(selector: string, text: string): string {
    this.typed.push({ selector, text })
    return this.#maskInputs && PASSWORD_FIELDS.has(selector) && text !== ''
      ? MASKED_VALUE
      : text
  }
}
