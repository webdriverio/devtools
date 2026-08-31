// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { accessibilityTreeScript } from '@wdio/devtools-shared'
import type { AccessibilityNode } from '@wdio/devtools-shared'
import { accessibilityNodesToSnapshotNodes } from '../src/element-snapshot.js'

/** The script is injectable source, so it is run the way the adapters run it. */
function a11yNodes(html: string, runner: 'mocha' | 'nightwatch') {
  document.body.innerHTML = html
  return new Function(
    `return ${accessibilityTreeScript(false, runner)}`
  )() as AccessibilityNode[]
}

beforeEach(() => {
  // happy-dom has no layout engine, so the script's visibility gate would reject
  // every element and the walk would return nothing.
  Element.prototype.checkVisibility = () => true
})

describe('accessibilityNodesToSnapshotNodes', () => {
  it('yields its tag from a captured locator in either dialect', () => {
    // The serializer reads the tag back out of the locator it was handed, so a
    // dialect it can't parse would report the ARIA role as the tag instead.
    for (const runner of ['mocha', 'nightwatch'] as const) {
      const nodes = accessibilityNodesToSnapshotNodes(
        a11yNodes('<a href="/logout"><i></i> Logout</a>', runner),
        { inViewportOnly: false }
      )

      expect(nodes.find((n) => n.name === 'Logout')?.tagName).toBe('a')
    }
  })
})
