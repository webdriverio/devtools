import type * as WdioSnapshot from '@wdio/snapshot'
import type { NativePlatform, SnapshotNode, SnapshotRef } from '@wdio/snapshot'
import type { SnapshotElement } from '@wdio/devtools-core/element-types'
import { deepCapString } from '@wdio/devtools-shared/device'
import type { GetSnapshotResult } from './get-snapshot.js'
import { SnapshotError } from './snapshot-error.js'

type WdioSnapshotModule = typeof WdioSnapshot

const frameHint = (ref: string) => `wdio session frame ${ref}`

const NATIVE_PLATFORMS = new Set(['android', 'ios', 'mac', 'windows'])

let loadFailureLogged = false

let wdioSnapshotResolved: boolean | undefined

export function resolvesWdioSnapshot(): boolean {
  wdioSnapshotResolved ??= (() => {
    try {
      import.meta.resolve('@wdio/snapshot')
      return true
    } catch {
      return false
    }
  })()
  return wdioSnapshotResolved
}

export async function loadWdioSnapshot(): Promise<
  WdioSnapshotModule | undefined
> {
  try {
    return await import('@wdio/snapshot')
  } catch (err) {
    if (!loadFailureLogged) {
      loadFailureLogged = true
      console.warn(
        `@wdio/elements: could not load @wdio/snapshot, using the legacy snapshot renderer: ${(err as Error).message}`
      )
    }
    return undefined
  }
}

// @wdio/session's `classify`: a browserName makes a mobile session web. Desktop
// browsers also report mac/windows here, which their browserName excludes too.
function nativePlatformName(caps: Record<string, unknown>): string | undefined {
  const platformName = (
    deepCapString(caps, 'platformName') ??
    deepCapString(caps, 'appium:platformName') ??
    ''
  ).toLowerCase()
  return NATIVE_PLATFORMS.has(platformName) &&
    !deepCapString(caps, 'browserName')
    ? platformName
    : undefined
}

export async function getWdioSnapshot(
  snapshot: WdioSnapshotModule,
  browser: WebdriverIO.Browser,
  viewport: boolean
): Promise<GetSnapshotResult> {
  const caps = browser.capabilities as Record<string, unknown>
  const platformName = nativePlatformName(caps)
  try {
    const { tree, refs } = platformName
      ? await collectNative(
          snapshot,
          browser,
          snapshot.nativePlatform(caps, platformName),
          viewport
        )
      : await collectWebTree(snapshot, browser, viewport)

    snapshot.attachSelectors(tree, refs)
    return {
      format: 'snapshot',
      text: snapshot.formatSnapshot(tree, { selectors: true, frameHint }),
      elements: elementsFromRefs(tree, refs),
      refs
    }
  } catch (err) {
    if (err instanceof snapshot.SnapshotError) {
      throw new SnapshotError(err.code, err.message, { hint: err.hint })
    }
    throw err
  }
}

// Keyed by ref id, with the selector the rendered text prints for it.
function elementsFromRefs(
  tree: SnapshotNode,
  refs: SnapshotRef[]
): Record<string, SnapshotElement> {
  const printed = new Map<string, string>()
  collectPrintedSelectors(tree, printed)
  return Object.fromEntries(
    refs.map((ref) => [
      ref.id,
      {
        selector: printed.get(ref.id) ?? '',
        tagName: '',
        role: ref.role,
        text: ref.name ?? ''
      }
    ])
  )
}

function collectPrintedSelectors(
  node: SnapshotNode,
  printed: Map<string, string>
): void {
  if (node.ref && node.selector) {
    printed.set(node.ref, node.selector)
  }
  node.children?.forEach((child) => collectPrintedSelectors(child, printed))
}

const classicUnavailable = new WeakSet<WebdriverIO.Browser>()

async function collectWebTree(
  snapshot: WdioSnapshotModule,
  browser: WebdriverIO.Browser,
  viewport: boolean
) {
  const classic = browser.isBidi && !classicUnavailable.has(browser)
  const result = await snapshot.collectWeb(
    browser,
    { counter: 0, all: false, boxes: false, viewport, assignRefs: 'ephemeral' },
    // BiDi tries classic `executeScript` until it fails once, then `execute`; same rule as collectTop in @wdio/session.
    { transport: classic ? 'classic-first' : 'bidi' }
  )
  if (result.classicUnavailable) {
    classicUnavailable.add(browser)
  }
  return result
}

async function collectNative(
  snapshot: WdioSnapshotModule,
  browser: WebdriverIO.Browser,
  platform: NativePlatform,
  viewport: boolean
): Promise<{ tree: SnapshotNode; refs: SnapshotRef[] }> {
  const [xml, size] = await Promise.all([
    browser.getPageSource(),
    viewport ? browser.getWindowSize() : undefined
  ])
  const parsed = snapshot.parseNativeSource(xml, platform, {
    all: false,
    counter: 0
  })
  // A zero-size window (minimized, broken ADB) would clip every element out of the tree.
  if (!size?.width || !size?.height) {
    return parsed
  }
  const tree =
    snapshot.inViewport(parsed.tree, size.width, size.height) ?? parsed.tree
  const shown = refIds(tree)
  return { tree, refs: parsed.refs.filter((ref) => shown.has(ref.id)) }
}

function refIds(node: SnapshotNode, ids = new Set<string>()): Set<string> {
  if (node.ref) {
    ids.add(node.ref)
  }
  node.children?.forEach((child) => refIds(child, ids))
  return ids
}
