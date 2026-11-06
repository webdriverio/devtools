import type { SnapshotElement } from '@wdio/devtools-core/element-types'
import type { SnapshotRef } from './snapshot-types.js'
import { getSnapshot as getLegacySnapshot } from './legacy-snapshot.js'
import { usesWdioSnapshot } from './webdriverio-version.js'
import {
  renderWdioSnapshot,
  resolvesWdioSnapshot,
  wdioSnapshotLoadFailed
} from './wdio-snapshot.js'

export type SnapshotFormat = 'legacy' | 'snapshot'

export interface GetSnapshotOptions {
  /** Only include what intersects the viewport (default true on both renderers). */
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

/** `snapshot` when WebdriverIO and @wdio/snapshot are both 10.2 or later, else `legacy`. */
export function snapshotRenderer(): SnapshotFormat {
  return usesWdioSnapshot() &&
    resolvesWdioSnapshot() &&
    !wdioSnapshotLoadFailed()
    ? 'snapshot'
    : 'legacy'
}

/** `format` is what rendered, which can differ from `snapshotRenderer()` if @wdio/snapshot fails to load. */
export async function getSnapshot(
  browser: WebdriverIO.Browser,
  options: GetSnapshotOptions = {}
): Promise<GetSnapshotResult> {
  const viewport = options.viewport ?? options.inViewportOnly ?? true
  const rendered =
    snapshotRenderer() === 'snapshot'
      ? await renderWdioSnapshot(browser, viewport)
      : undefined
  if (rendered) {
    return rendered
  }
  const legacy = await getLegacySnapshot(browser, { inViewportOnly: viewport })
  return { format: 'legacy', ...legacy }
}
