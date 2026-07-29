// Accessibility-snapshot text for the A11y tree panel. The panel takes no
// properties and no context — it follows the `show-command` event — so a spec
// hands these strings to a `CommandLog.snapshotText`, the field the trace reader
// fills from the per-action `-snapshot.txt` resource.
//
// The lines are composed from shared's snapshot-format tokens rather than typed
// out: the producer (core's `serializeWebSnapshot`) and the panel's parser both
// reference those constants, so a fixture built from them can't drift from the
// grammar the panel is written against.

import {
  SNAPSHOT_INDENT_UNIT,
  SNAPSHOT_LOCATOR_DELIM,
  SNAPSHOT_PAGE_HEADER,
  SNAPSHOT_PURPOSE_TOKEN
} from '@wdio/devtools-shared'
import type { CommandLog } from '@wdio/devtools-shared'

import { commandLog } from '../../support/builders.js'

export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
export const PAGE_TITLE = 'The Internet'

/** `[Page: <title> — <url>]`, as the serializer writes the first line. */
export const PAGE_HEADER = `${SNAPSHOT_PAGE_HEADER}: ${PAGE_TITLE} — ${LOGIN_URL}]`

export const USERNAME_LOCATOR = '#username'
export const PASSWORD_LOCATOR = '#password'
export const LOGIN_LOCATOR = 'button[type=submit]'

/** The locator the spec writes in place of the captured one — same element,
 *  different syntax, which is what the reveal fallback to accessible name is
 *  for. */
export const LOGIN_LOCATOR_ALIAS = 'button*=Login'

interface NodeLine {
  depth: number
  role: string
  name?: string
  /** Inferred ancestor context — the panel drops it from the rendered row. */
  purpose?: string
  selector?: string
}

/** One serialized node line. Nodes sit one indent unit below the header, hence
 *  `depth + 1` — the same offset the panel's parser subtracts back off. */
export function a11yLine({
  depth,
  role,
  name,
  purpose,
  selector
}: NodeLine): string {
  const parts = [`${SNAPSHOT_INDENT_UNIT.repeat(depth + 1)}${role}`]
  if (name !== undefined) {
    parts.push(`"${name}"`)
  }
  if (purpose) {
    parts.push(`${SNAPSHOT_PURPOSE_TOKEN} "${purpose}"`)
  }
  const line = parts.join(' ')
  return selector ? `${line}  ${SNAPSHOT_LOCATOR_DELIM}  ${selector}` : line
}

/** Login page: two nameless containers, three locator-bearing controls, one
 *  heading with a level suffix, and depths 0–2. */
export const loginSnapshot = [
  PAGE_HEADER,
  a11yLine({ depth: 0, role: 'document', name: PAGE_TITLE }),
  a11yLine({ depth: 1, role: 'heading[2]', name: 'Login Page' }),
  a11yLine({ depth: 1, role: 'form' }),
  a11yLine({
    depth: 2,
    role: 'textbox',
    name: 'Username',
    purpose: 'Login form',
    selector: USERNAME_LOCATOR
  }),
  a11yLine({
    depth: 2,
    role: 'textbox',
    name: 'Password',
    purpose: 'Login form',
    selector: PASSWORD_LOCATOR
  }),
  a11yLine({
    depth: 2,
    role: 'button',
    name: 'Login',
    purpose: 'Login form',
    selector: LOGIN_LOCATOR
  }),
  a11yLine({ depth: 1, role: 'contentinfo' })
].join('\n')

/** Roles in render order, so a spec names them once. */
export const LOGIN_ROLES = [
  'document',
  'heading[2]',
  'form',
  'textbox',
  'textbox',
  'button',
  'contentinfo'
]

/** Quoted accessible names in render order — the two containers have none. */
export const LOGIN_NAMES = [
  `"${PAGE_TITLE}"`,
  '"Login Page"',
  '"Username"',
  '"Password"',
  '"Login"'
]

/** A page the capture reached before any element was on it. */
export const headerOnlySnapshot = PAGE_HEADER

/** Mobile captures carry no `[Page …]` line, so the first line is a node. */
export const headerlessSnapshot = [
  a11yLine({ depth: 0, role: 'document', name: PAGE_TITLE }),
  a11yLine({ depth: 1, role: 'button', name: 'Login', selector: LOGIN_LOCATOR })
].join('\n')

/** 80 characters — past the panel's 64-character name budget. */
export const LONG_NAME =
  'Login and continue to the secure area with the credentials from the demo page'

export const longNameSnapshot = [
  PAGE_HEADER,
  a11yLine({
    depth: 0,
    role: 'button',
    name: LONG_NAME,
    selector: LOGIN_LOCATOR
  })
].join('\n')

export const loginCommand: CommandLog = commandLog({
  command: 'click',
  args: [LOGIN_LOCATOR],
  snapshotText: loginSnapshot
})

/** What a Selenium or Nightwatch trace carries: a real command, no snapshot —
 *  per-command DOM/a11y capture is WDIO-only. */
export const snapshotlessCommand: CommandLog = commandLog({
  command: 'setValue',
  args: [USERNAME_LOCATOR, 'tomsmith'],
  result: null
})
