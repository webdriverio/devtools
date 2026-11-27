/**
 * A native page source → the element list and A11y text of one action.
 *
 * Shared by core's per-action capture and the backend, which runs it for an
 * adapter that captured the page source but cannot parse it (Python).
 */

import type { NativePlatform } from '@wdio/devtools-shared'

import { UNBOUNDED_VIEWPORT } from './locators/constants.js'
import {
  generateAllElementLocators,
  getDefaultFilters,
  type ElementWithLocators
} from './locators/index.js'
import { xmlToJSON } from './locators/xml-parsing.js'
import { serializeMobileSnapshot } from './mobile-snapshot.js'

export interface NativeSnapshot {
  snapshotText: string
  elements: ElementWithLocators[]
}

// A hybrid app in a webview answers /source with the page's HTML, which an XML parse turns into noise.
function isHtmlSource(pageSource: string): boolean {
  return /^\s*<(!doctype\s+html|html[\s>])/i.test(pageSource)
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function serializeSource(pageSource: string, platform: NativePlatform): string {
  const jsonTree = xmlToJSON(pageSource)
  if (!jsonTree) {
    return `[${platform}]`
  }
  jsonTree.attributes._sourceXML = pageSource
  return serializeMobileSnapshot(jsonTree, { platform, sourceXML: pageSource })
}

/** Undefined for a webview's HTML source, which carries no native tree, or one that cannot be serialized. A session that names no platform is read as Android. */
export function nativeSnapshotFromPageSource(
  pageSource: string,
  platform: NativePlatform = 'android'
): NativeSnapshot | undefined {
  if (isHtmlSource(pageSource)) {
    return undefined
  }
  let snapshotText: string
  try {
    snapshotText = serializeSource(pageSource, platform)
  } catch (err) {
    console.warn(
      `[devtools] native page source could not be serialized: ${describeError(err)}`
    )
    return undefined
  }
  try {
    return {
      snapshotText,
      elements: generateAllElementLocators(pageSource, {
        platform,
        viewportSize: UNBOUNDED_VIEWPORT,
        filters: getDefaultFilters(platform, false),
        inViewportOnly: false
      })
    }
  } catch (err) {
    // The text is the primary deliverable; a locator failure costs the element list alone.
    console.warn(
      `[devtools] native element locators failed: ${describeError(err)}`
    )
    return { snapshotText, elements: [] }
  }
}
