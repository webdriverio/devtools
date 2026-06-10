// Adapter-agnostic per-action snapshot capture. Each adapter wires its own
// `runScript`, `takeScreenshot`, etc. shim so the actual capture pipeline
// (timeouts, fallbacks, snapshot serialization) lives in one place.

import { accessibilityTreeScript, elementsScript } from './element-scripts.js'
import { serializeWebSnapshot } from './element-snapshot.js'
import type { AccessibilityNode, BrowserElementInfo } from './element-types.js'
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
    const [shot, url, title, tree, elements] = await Promise.all([
      input.takeScreenshot?.().catch(() => null) ?? Promise.resolve(null),
      input.getUrl?.().catch(() => undefined) ?? Promise.resolve(undefined),
      input.getTitle?.().catch(() => undefined) ?? Promise.resolve(undefined),
      runWith<AccessibilityNode[]>(
        input.runScript,
        accessibilityTreeScript(true),
        []
      ),
      runWith<BrowserElementInfo[]>(
        input.runScript,
        elementsScript(false, true),
        []
      )
    ])
    const snapshotText = serializeWebSnapshot(tree, { url, title })
    return {
      timestamp,
      command: input.command,
      url,
      title,
      screenshot: shot ?? undefined,
      elements,
      snapshotText
    }
  } catch {
    return null
  }
}
