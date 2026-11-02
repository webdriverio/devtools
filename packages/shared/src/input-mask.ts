// What a run keeps of typed text: masked by default before it leaves the browser or the adapter process.

import type { BaseDevToolsOptions } from './types.js'

/** What every masked value reads as. Fixed, so a value's length never leaks. */
export const MASKED_VALUE = '••••'

/** The options every JS adapter takes; Python's `enable()` takes them as `mask_inputs` / `mask_selectors`. */
export type CaptureMaskOptions = Pick<
  BaseDevToolsOptions,
  'maskInputs' | 'maskSelectors'
>

/** The resolved policy the collector reads. */
export interface CaptureMaskConfig {
  inputs: boolean
  selectors: string[]
}

export const DEFAULT_CAPTURE_MASK: CaptureMaskConfig = {
  inputs: true,
  selectors: []
}

/** Input types whose value is a label or a choice the page already shows, never typed text. */
export const UNMASKED_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'submit',
  'button',
  'reset',
  'image',
  'range',
  'color',
  'file'
])

/** Typed values shorter than this are not scrubbed out of free text, where a short one would rewrite unrelated words. */
export const SCRUB_MIN_LENGTH = 4

export function resolveCaptureMask(
  options: CaptureMaskOptions = {}
): CaptureMaskConfig {
  return {
    inputs: options.maskInputs !== false,
    selectors: (options.maskSelectors ?? [])
      .map((selector) => selector.trim())
      .filter(Boolean)
  }
}

/** The name the collector bundle reads its policy from, declared by {@link withCaptureMask}. */
export const CAPTURE_MASK_GLOBAL = '__wdioCaptureMask'

/** The declaration put before the collector source. A `var` in the caller's wrapper function, so the page never sees it. */
export function captureMaskPrelude(config: CaptureMaskConfig): string {
  return `var ${CAPTURE_MASK_GLOBAL} = ${JSON.stringify({ inputs: config.inputs, selectors: config.selectors })};\n`
}

/** The collector source with its policy declared ahead of it. */
export function withCaptureMask(
  source: string,
  config: CaptureMaskConfig
): string {
  return `${captureMaskPrelude(config)}${source}`
}

/** The forms a typed value takes inside a request body or a log line. */
export function typedValueForms(value: string): string[] {
  if (value.length < SCRUB_MIN_LENGTH) {
    return []
  }
  const uri = encodeURIComponent(value)
  const json = JSON.stringify(value).slice(1, -1)
  return [...new Set([value, uri, uri.replace(/%20/g, '+'), json])]
}

/** One pattern for every form of every value, longest first so a value inside another is not split; null for none. */
export function typedValuePattern(values: Iterable<string>): RegExp | null {
  const forms = [...new Set([...values].flatMap(typedValueForms))].sort(
    (a, b) => b.length - a.length
  )
  if (forms.length === 0) {
    return null
  }
  const escaped = forms.map((form) =>
    form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )
  // eslint-disable-next-line security/detect-non-literal-regexp -- every alternative is an escaped literal
  return new RegExp(escaped.join('|'), 'g')
}

/** `text` with every form of every value replaced by {@link MASKED_VALUE} in one pass. */
export function scrubTypedValues(
  text: string,
  values: Iterable<string>
): string {
  const pattern = typedValuePattern(values)
  return pattern ? text.replace(pattern, MASKED_VALUE) : text
}

/** The CSS for elements whose own text is what a test types into: an editable region or an ARIA textbox. */
export const TYPING_SURFACE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'
