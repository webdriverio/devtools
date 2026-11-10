// The run's page mask policy, set from an adapter's options and declared ahead of every collector source it loads.

import {
  DEFAULT_CAPTURE_MASK,
  resolveCaptureMask,
  type CaptureMaskConfig,
  type CaptureMaskOptions
} from '@wdio/devtools-shared'

let mask: CaptureMaskConfig = DEFAULT_CAPTURE_MASK

export function configureInputMasking(
  options: CaptureMaskOptions = {}
): CaptureMaskConfig {
  mask = resolveCaptureMask(options)
  return mask
}

export function captureMask(): CaptureMaskConfig {
  return mask
}
