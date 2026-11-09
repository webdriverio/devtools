// What the replayed page keeps of form values: the collector masks password fields, and anything the run names, before they leave the browser.

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

/** Characters a user's selector could use to end the script or a comment it is written into; JSON reads `\\uXXXX` back as the same text. */
const UNSAFE_IN_SCRIPT = /[<>/\u2028\u2029]/g

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE_IN_SCRIPT,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/** The declaration put before the collector source. A `var` in the caller's wrapper function, so the page never sees it. */
export function captureMaskPrelude(config: CaptureMaskConfig): string {
  return `var ${CAPTURE_MASK_GLOBAL} = ${scriptSafeJson({ inputs: config.inputs, selectors: config.selectors })};\n`
}

/** The collector source with its policy declared ahead of it. */
export function withCaptureMask(
  source: string,
  config: CaptureMaskConfig
): string {
  return `${captureMaskPrelude(config)}${source}`
}
