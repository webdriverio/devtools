// What input masking redacts on its own, without a `secrets` entry: text typed into a password field, and credential headers.

import { MIN_SECRET_LENGTH } from './redaction-walk.js'

/** WebDriver's special keys (Enter, Tab, ...) live in the Private Use Area; they are keys pressed, not text typed. */
export const SPECIAL_KEY_CLASS = '[\\uE000-\\uF8FF]'

// eslint-disable-next-line security/detect-non-literal-regexp -- a constant character class
const SPECIAL_KEY = new RegExp(SPECIAL_KEY_CLASS, 'g')

/** The text a key-sending command typed: its string and number parts joined, special keys removed. */
export function typedText(parts: unknown): string {
  const list = Array.isArray(parts) ? parts : [parts]
  return list
    .filter(
      (part): part is string | number =>
        typeof part === 'string' || typeof part === 'number'
    )
    .map(String)
    .join('')
    .replace(SPECIAL_KEY, '')
}

/** Whether a value is long enough to redact, by the same rule `secrets` entries follow. */
export function isRedactableValue(text: string): boolean {
  return [...text.trim()].length >= MIN_SECRET_LENGTH
}

/** Whether an element's `type` reading names a password field. */
export function isPasswordFieldType(type: unknown): boolean {
  return typeof type === 'string' && type.trim().toLowerCase() === 'password'
}

/** Whether typed text joins the run's secrets: long enough, and typed into a password field or one whose type read never answered, since redacting a non-password is the safer error. */
export function redactsTypedText(
  text: string,
  fieldType: unknown,
  answered = true
): boolean {
  return (
    isRedactableValue(text) && (!answered || isPasswordFieldType(fieldType))
  )
}
