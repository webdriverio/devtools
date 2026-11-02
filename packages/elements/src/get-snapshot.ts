import type { SnapshotElement } from '@wdio/devtools-core/element-types'
import type { SnapshotRef } from '@wdio/snapshot'
import { getSnapshot as getLegacySnapshot } from './legacy-snapshot.js'
import { usesWdioSnapshot } from './webdriverio-version.js'
import { getWdioSnapshot, loadWdioSnapshot } from './wdio-snapshot.js'

export type SnapshotFormat = 'legacy' | 'snapshot'

export interface GetSnapshotOptions {
  /** Only include what intersects the viewport (legacy default true, snapshot default false). */
  inViewportOnly?: boolean
  /** Same as `inViewportOnly`; wins when both are set. */
  viewport?: boolean
}

export interface GetSnapshotResult {
  format: SnapshotFormat
  /** Accessibility tree as text, one `eN` ref per actionable element. */
  text: string
  elements: Record<string, SnapshotElement>
  /** Set on the `snapshot` format: the candidate selectors of each ref. */
  refs?: SnapshotRef[]
}

/** The renderer `getSnapshot` picks for the installed WebdriverIO. */
export function snapshotRenderer(): SnapshotFormat {
  return usesWdioSnapshot() ? 'snapshot' : 'legacy'
}

/**
 * Same text as `wdio session snapshot --selectors [--viewport]` on WebdriverIO
 * 10.2 and later, where `@wdio/snapshot` renders; the legacy renderer below it.
 */
export async function getSnapshot(
  browser: WebdriverIO.Browser,
  options: GetSnapshotOptions = {}
): Promise<GetSnapshotResult> {
  const wdioSnapshot =
    snapshotRenderer() === 'snapshot' ? await loadWdioSnapshot() : undefined
  if (wdioSnapshot) {
    return getWdioSnapshot(
      wdioSnapshot,
      browser,
      options.viewport ?? options.inViewportOnly ?? false
    )
  }
  const legacy = await getLegacySnapshot(browser, {
    inViewportOnly: options.viewport ?? options.inViewportOnly ?? true
  })
  return { format: 'legacy', ...legacy }
}
