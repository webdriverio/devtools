// Adapter-agnostic per-action snapshot capture. Each adapter wires its own
// `runScript`, `takeScreenshot`, etc. shim so the actual capture pipeline
// (timeouts, fallbacks, snapshot serialization) lives in one place.

import { accessibilityTreeScript, elementsScript } from './element-scripts.js'
import {
  serializeWebSnapshot,
  serializeMobileSnapshot
} from './element-snapshot.js'
import type { AccessibilityNode, BrowserElementInfo } from './element-types.js'
import { xmlToJSON } from './locators/xml-parsing.js'
import {
  generateAllElementLocators,
  getDefaultFilters
} from './locators/index.js'
import { SNAPSHOT_PROBE_TIMEOUT_MS, withTimeout } from './with-timeout.js'
import type { ActionSnapshot } from '@wdio/devtools-shared'

export type ScriptRunner = (scriptSrc: string) => Promise<unknown>

export interface CaptureActionSnapshotInput {
  command: string
  /** Browser script runner — omit on native mobile where Appium can't execute JS. */
  runScript?: ScriptRunner
  takeScreenshot?: () => Promise<string | null | undefined>
  getUrl?: () => Promise<string | undefined>
  getTitle?: () => Promise<string | undefined>
  /** Page-source XML fetcher for native mobile — used instead of runScript. */
  getPageSource?: () => Promise<string | undefined>
  /** Platform identifier for mobile snapshot formatting ('android' | 'ios'). */
  platform?: 'android' | 'ios'
}

async function runWith<T>(
  runScript: ScriptRunner | undefined,
  scriptSrc: string,
  fallback: T
): Promise<T> {
  if (!runScript) {
    return fallback
  }

  return withTimeout(
    runScript(scriptSrc).then((r) => r as T),
    SNAPSHOT_PROBE_TIMEOUT_MS,
    fallback
  ).catch(() => fallback)
}

export async function captureActionSnapshot(
  input: CaptureActionSnapshotInput
): Promise<ActionSnapshot | null> {
  try {
    const timestamp = Date.now()
    const isNativeMobile = !input.runScript && !!input.getPageSource

    const [shot, url, title, pageSource, tree, elements] = await Promise.all([
      input.takeScreenshot?.().catch(() => null),
      input.getUrl?.().catch(() => undefined),
      input.getTitle?.().catch(() => undefined),
      isNativeMobile
        ? input.getPageSource?.().catch(() => undefined)
        : undefined,
      runWith<AccessibilityNode[]>(
        input.runScript,
        accessibilityTreeScript(true),
        []
      ),
      runWith<BrowserElementInfo[]>(
        input.runScript,
        // includeBounds: the per-action element rects drive A8 input points.
        elementsScript(true, true),
        []
      )
    ])

    let snapshotText: string
    let finalElements: unknown[] = elements

    if (isNativeMobile && pageSource) {
      const platform = input.platform ?? 'android'
      const jsonTree = xmlToJSON(pageSource)
      if (jsonTree) {
        jsonTree.attributes._sourceXML = pageSource
        snapshotText = serializeMobileSnapshot(jsonTree, {
          platform,
          sourceXML: pageSource
        })
      } else {
        snapshotText = `[${platform}]`
      }
      // Generate mobile element locators from the page source XML.
      try {
        const viewport = { width: 9999, height: 9999 }
        const filters = getDefaultFilters(platform, false)
        const locators = generateAllElementLocators(pageSource, {
          platform,
          viewportSize: viewport,
          filters,
          inViewportOnly: false
        })
        finalElements = locators
      } catch {
        // Non-fatal — snapshot text is the primary deliverable.
      }
    } else {
      snapshotText = serializeWebSnapshot(tree, { url, title })
    }

    return {
      timestamp,
      command: input.command,
      url,
      title,
      screenshot: shot ?? undefined,
      elements: finalElements,
      snapshotText
    }
  } catch {
    return null
  }
}
