import { describe, expect, it, vi } from 'vitest'
import xpath from 'xpath'

import { generateAllElementLocators } from '../src/locators/index.js'
import { xmlToDOM } from '../src/locators/xml-parsing.js'
import {
  parseSimpleXPath,
  selectIndexed,
  withXPathIndex
} from '../src/locators/xpath-index.js'

const ANDROID = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout resource-id="root" text="">
    <android.widget.TextView resource-id="title" text="Clock" content-desc="Clock"/>
    <android.widget.Button resource-id="btn" text="Start and stop" content-desc="start"/>
    <android.widget.Button resource-id="btn" text="Reset" content-desc=""/>
    <android.widget.LinearLayout>
      <android.widget.Button resource-id="btn" text="Reset"/>
      <android.widget.TextView text="it's a 'quoted' label"/>
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`

const IOS = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="Settings" label="Settings">
  <XCUIElementTypeWindow>
    <XCUIElementTypeNavigationBar name="Settings"/>
    <XCUIElementTypeCell name="General" label="General" value=""/>
    <XCUIElementTypeCell name="General" label="General"/>
    <XCUIElementTypeStaticText name="Wi-Fi" label="Wi-Fi" value="Off"/>
    <XCUIElementTypeButton name="Back" label="Back"/>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`

/** Every XPath form the locator generator issues, for every element. */
function expressionsFor(xml: string): string[] {
  const doc = xmlToDOM(xml)!
  const exprs = new Set<string>(['//*'])
  const all = xpath.select(
    '//*',
    doc as unknown as Node
  ) as unknown as Element[]
  for (const el of all) {
    exprs.add(`//${el.nodeName}`)
    const conds: string[] = []
    for (let i = 0; i < el.attributes.length; i++) {
      const { name, value } = el.attributes[i]
      const q = value.includes('"') ? "'" : '"'
      exprs.add(`//*[@${name}=${q}${value}${q}]`)
      exprs.add(`//${el.nodeName}[@${name}=${q}${value}${q}]`)
      conds.push(`@${name}=${q}${value}${q}`)
    }
    if (conds.length > 1) {
      exprs.add(`//${el.nodeName}[${conds.join(' and ')}]`)
    }
  }
  exprs.add('//*[@name="nobody"]')
  exprs.add('//Nothing[@name="x"]')
  return [...exprs]
}

describe('selectIndexed', () => {
  for (const [label, xml] of [
    ['Android', ANDROID],
    ['iOS', IOS]
  ] as const) {
    it(`selects the same nodes as the xpath library, in order (${label})`, () => {
      const doc = xmlToDOM(xml)!
      withXPathIndex(doc, () => {
        for (const expr of expressionsFor(xml)) {
          // xmldom types are not DOM's Node; the library reads them at runtime.
          const expected = xpath.select(
            expr,
            doc as unknown as Node
          ) as unknown[]
          expect(selectIndexed(doc, expr), expr).toEqual(expected)
        }
      })
    })
  }

  it('declines anything outside the simple forms, so the library answers it', () => {
    for (const expr of [
      '/hierarchy/*',
      '//a/b',
      '//*[contains(@text, "x")]',
      '//*[@text="a\\"b"]',
      '//*[@a="x" or @b="y"]',
      '(//*[@a="x"])[2]',
      '//*[@a="x"][2]'
    ]) {
      expect(parseSimpleXPath(expr), expr).toBeNull()
    }
  })

  it('answers nothing outside a walk, nor for a namespaced document', () => {
    const plain = xmlToDOM(IOS)!
    expect(selectIndexed(plain, '//*')).toBeNull()
    const namespaced = xmlToDOM(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="a"/></body></html>'
    )!
    withXPathIndex(namespaced, () => {
      expect(selectIndexed(namespaced, '//div[@id="a"]')).toBeNull()
    })
  })

  it('keeps locator generation off the full-scan path on a large page source', () => {
    const cell = (i: number) =>
      `<XCUIElementTypeCell name="row-${i % 50}" label="Row ${i}" value="${i}"/>`
    const big = `<?xml version="1.0"?><XCUIElementTypeApplication name="App"><XCUIElementTypeWindow>${Array.from(
      { length: 1500 },
      (_, i) => cell(i)
    ).join('')}</XCUIElementTypeWindow></XCUIElementTypeApplication>`
    const scans = vi.spyOn(xpath, 'select')
    try {
      const els = generateAllElementLocators(big, {
        platform: 'ios',
        inViewportOnly: false
      })
      expect(els.length).toBeGreaterThan(1000)
      // Before the index this was several full-document scans per element.
      expect(scans.mock.calls.length).toBeLessThan(els.length)
    } finally {
      scans.mockRestore()
    }
  })
})
