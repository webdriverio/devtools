// Input masking learns a password as it is typed: an element's sendKeys reads the field's type first.

import { noteTypedInput } from '@wdio/devtools-core'

interface ElementWithProperty {
  getProperty: (name: string) => Promise<unknown>
}

function hasGetProperty(element: unknown): element is ElementWithProperty {
  return (
    typeof (element as { getProperty?: unknown } | null)?.getProperty ===
    'function'
  )
}

/** Adds what a sendKeys types to the run's secrets when its element is a password field, never on a native app; `getProperty` is untracked, so the read records no row. */
export function noteTypedIntoElement(
  element: unknown,
  args: unknown[],
  nativeApp: boolean
): Promise<void> {
  if (nativeApp || !hasGetProperty(element)) {
    return Promise.resolve()
  }
  return noteTypedInput(args, () => element.getProperty('type'))
}
