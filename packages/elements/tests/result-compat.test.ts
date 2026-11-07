import { describe, expect, it } from 'vitest'
import {
  getSnapshot,
  type GetSnapshotResult,
  type SnapshotResult
} from '../src/index.js'

// Compiled by `pnpm typecheck`: code written against the pre-format types must still build.
async function usesPreFormatTypes(browser: WebdriverIO.Browser) {
  const result: SnapshotResult = await getSnapshot(browser)
  const selector: string | undefined = result.elements['e1']?.selector
  const legacy = await getSnapshot(browser, { inViewportOnly: false })
  const assignable: SnapshotResult = legacy
  return [selector, assignable.text]
}

describe('GetSnapshotResult compatibility', () => {
  it('keeps the pre-format SnapshotResult assignable from getSnapshot', () => {
    const fromNew: GetSnapshotResult = {
      format: 'snapshot',
      text: '',
      elements: {}
    }
    const fromOld: SnapshotResult = fromNew
    expect(fromOld.elements).toEqual({})
    expect(usesPreFormatTypes).toBeTypeOf('function')
  })
})

describe('public entry', () => {
  it('exports only the 1.x values plus the renderer additions', async () => {
    const entry = await import('../src/index.js')
    expect(Object.keys(entry).sort()).toEqual(
      [
        'getInteractableBrowserElements',
        'getBrowserAccessibilityTree',
        'getMobileVisibleElements',
        'getElements',
        'serializeWebSnapshot',
        'serializeMobileSnapshot',
        'getSnapshot',
        'snapshotRenderer',
        'SnapshotError'
      ].sort()
    )
  })
})
