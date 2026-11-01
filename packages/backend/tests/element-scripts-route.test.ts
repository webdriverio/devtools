/**
 * The page-side element scripts, served like the collector.
 *
 * They are what fills the A11y tab. `core/action-snapshot.ts` runs them
 * in-process for the JS adapters, but an adapter that cannot import that
 * package — the Python one — had no route to them at all, which is why a
 * Python trace carried no `*-elements.json` while a JS Selenium trace of the
 * same flow carried 12.
 */

import { describe, it, expect } from 'vitest'
import {
  ELEMENT_SCRIPTS_API,
  ELEMENT_SCRIPTS_CONTENT_TYPE,
  accessibilityTreeScript,
  elementsScript,
  isTestRunnerId
} from '@wdio/devtools-shared'

describe('element scripts contract', () => {
  it('serves JSON from a path both sides agree on', () => {
    // The Python adapter generates this path into `_contract.py` from shared,
    // so a rename fails its drift check rather than 404ing at runtime.
    expect(ELEMENT_SCRIPTS_API.get).toBe('/api/element-scripts')
    expect(ELEMENT_SCRIPTS_CONTENT_TYPE).toContain('json')
  })

  // A JSON envelope rather than raw source, because a caller needs both.
  it('carries the two scripts the JS adapters run', () => {
    const a11y = accessibilityTreeScript(true, 'selenium-webdriver')
    const elements = elementsScript(true, true, 'selenium-webdriver')

    for (const script of [a11y, elements]) {
      expect(script.startsWith('(function () {')).toBe(true)
      expect(script.length).toBeGreaterThan(1000)
    }
  })
})

describe('the runner decides the locator dialect', () => {
  // Baked in at generation, which is why this is generated per request rather
  // than read once like the collector: a caller cannot patch a dialect into an
  // already-served string.
  it('produces different source for a WDIO runner than a protocol-level one', () => {
    expect(elementsScript(true, true, 'mocha')).not.toBe(
      elementsScript(true, true, 'selenium-webdriver')
    )
  })

  // An unknown value must not reach locatorDialect and silently pick a dialect
  // for a runner that is not one.
  it('narrows an untrusted runner before using it', () => {
    expect(isTestRunnerId('selenium-webdriver')).toBe(true)
    expect(isTestRunnerId('bogus')).toBe(false)
    expect(isTestRunnerId(undefined)).toBe(false)

    // What the route does with a query param: narrow, or drop.
    const raw: string = 'bogus'
    const narrowed = isTestRunnerId(raw) ? raw : undefined
    expect(elementsScript(true, true, narrowed)).toBe(
      elementsScript(true, true, undefined)
    )
  })
})
