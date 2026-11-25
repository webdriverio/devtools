import { MASKED_VALUE, type CommandLog } from '@wdio/devtools-shared'

import { PASSWORD_FIELDS, RULES, SCENARIO_SECRET, SCOPES } from './constants.js'
import type { GroundTruth, RecordedStream, Violation } from './types.js'

/** WebDriver's special keys say which key was pressed; the typed text is what is left. */
const SPECIAL_KEY = /[\uE000-\uF8FF]/gu

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value.replace(SPECIAL_KEY, ''))
  } else if (Array.isArray(value)) {
    value.forEach((item) => stringsIn(item, out))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => stringsIn(item, out))
  }
  return out
}

function argsCarry(row: CommandLog, text: string): boolean {
  return stringsIn(row.args).includes(text)
}

// The page masks a password field's value, which needs the run's policy ahead of every collector source; the row that typed some text carries it, a typed password as the placeholder.
export function checkPasswordMasking(
  stream: RecordedStream,
  truth: GroundTruth
): Violation[] {
  const undeclared =
    truth.undeclaredMaskPolicies > 0
      ? [
          {
            rule: RULES.passwordMaskedInPage,
            message: `${truth.undeclaredMaskPolicies} collector source(s) reached the page without the run's mask policy declared ahead of them`
          }
        ]
      : []
  const mutations = JSON.stringify(
    stream.frames
      .filter(({ scope }) => scope === SCOPES.mutations)
      .map(({ data }) => data)
  )
  const typed = truth.typed
    .map(({ selector, text }) => ({
      selector,
      text: text.replace(SPECIAL_KEY, '')
    }))
    .filter(({ text }) => text !== '')
  return [
    ...undeclared,
    ...typed.flatMap(({ selector, text }) => [
      ...(PASSWORD_FIELDS.has(selector) && mutations.includes(text)
        ? [
            {
              rule: RULES.passwordMaskedInPage,
              message: `the replayed page carries what was typed into ${selector}`
            }
          ]
        : []),
      // A listed secret is redacted on its row; `checkSecretRedaction` holds it to that.
      ...(stream.rows.some((row) =>
        argsCarry(row, text === SCENARIO_SECRET ? MASKED_VALUE : text)
      )
        ? []
        : [
            {
              rule: RULES.passwordMaskedInPage,
              message: `no row carries the text typed into ${selector}`
            }
          ])
    ])
  ]
}
