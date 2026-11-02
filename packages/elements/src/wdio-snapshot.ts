import { fileURLToPath } from 'node:url'
import type * as WdioSnapshot from '@wdio/snapshot'
import type { NativePlatform, SnapshotNode, SnapshotRef } from '@wdio/snapshot'
import type { SnapshotElement } from '@wdio/devtools-core/element-types'
import { deepCapString } from '@wdio/devtools-shared/device'
import type { GetSnapshotResult } from './get-snapshot.js'
import { isModuleNotFound, packageVersionOf } from './package-version.js'
import { safeCall } from './safe-call.js'
import { SnapshotError } from './snapshot-error.js'
import { rendersWithWdioSnapshot } from './snapshot-version.js'

type WdioSnapshotModule = typeof WdioSnapshot

const frameHint = (ref: string) => `wdio session frame ${ref}`

const NATIVE_PLATFORMS = new Set(['android', 'ios', 'mac', 'windows'])

const CLASSIC_FAILURES_BEFORE_BIDI = 2

let loadFailureLogged = false

let loadFailed = false

let wdioSnapshotSupported: boolean | undefined

export function resolvesWdioSnapshot(): boolean {
  wdioSnapshotSupported ??= (() => {
    try {
      const entry = fileURLToPath(import.meta.resolve('@wdio/snapshot'))
      const version = packageVersionOf(entry, '@wdio/snapshot')
      if (rendersWithWdioSnapshot(version)) {
        return true
      }
      if (version) {
        console.warn(
          `@wdio/elements: @wdio/snapshot ${version} is installed but the snapshot renderer needs 10.2 or later, using the legacy snapshot renderer`
        )
      }
      return false
    } catch (err) {
      if (!isModuleNotFound(err)) {
        console.warn(
          `@wdio/elements: could not resolve @wdio/snapshot, using the legacy snapshot renderer: ${(err as Error).message}`
        )
      }
      return false
    }
  })()
  return wdioSnapshotSupported
}

export function wdioSnapshotLoadFailed(): boolean {
  return loadFailed
}

async function loadWdioSnapshot(): Promise<WdioSnapshotModule | undefined> {
  try {
    return await import('@wdio/snapshot')
  } catch (err) {
    loadFailed = true
    if (!loadFailureLogged) {
      loadFailureLogged = true
      console.warn(
        `@wdio/elements: could not load @wdio/snapshot, using the legacy snapshot renderer: ${(err as Error).message}`
      )
    }
    return undefined
  }
}

// Matches @wdio/session's classify: a browserName makes a session web, even on mac/windows.
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

// Keeps the @wdio/snapshot type out of exports: consumers without the optional peer would fail to build.
export async function renderWdioSnapshot(
  browser: WebdriverIO.Browser,
  viewport: boolean
): Promise<GetSnapshotResult | undefined> {
  const snapshot = await loadWdioSnapshot()
  if (!snapshot) {
    return undefined
  }
  const caps = browser.capabilities as Record<string, unknown>
  const platformName = nativePlatformName(caps)
  try {
    const collected = platformName
      ? await collectNative(
          snapshot,
          browser,
          snapshot.nativePlatform(caps, platformName),
          viewport
        )
      : await collectWebTree(snapshot, browser, viewport)
    if (!collected) {
      return {
        format: 'snapshot',
        text: '[No elements found]',
        elements: {},
        refs: []
      }
    }
    const { tree, refs } = collected

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

// Keyed by ref id, for refs whose selector the rendered text prints.
function elementsFromRefs(
  tree: SnapshotNode,
  refs: SnapshotRef[]
): Record<string, SnapshotElement> {
  const printed = new Map<string, string>()
  collectPrintedSelectors(tree, printed)
  return Object.fromEntries(
    refs.flatMap((ref) => {
      const selector = printed.get(ref.id)
      return selector
        ? [
            [
              ref.id,
              { selector, tagName: '', role: ref.role, text: ref.name ?? '' }
            ] as const
          ]
        : []
    })
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

const classicFailures = new WeakMap<WebdriverIO.Browser, number>()

async function collectWebTree(
  snapshot: WdioSnapshotModule,
  browser: WebdriverIO.Browser,
  viewport: boolean
) {
  const failures = classicFailures.get(browser) ?? 0
  const classic = browser.isBidi && failures < CLASSIC_FAILURES_BEFORE_BIDI
  const result = await snapshot.collectWeb(
    browser,
    { counter: 0, all: false, boxes: false, viewport, assignRefs: 'ephemeral' },
    // 'bidi' is browser.execute; 'classic-first' applies only under BiDi, until executeScript fails CLASSIC_FAILURES_BEFORE_BIDI times in a row.
    { transport: classic ? 'classic-first' : 'bidi' }
  )
  if (classic) {
    classicFailures.set(browser, result.classicUnavailable ? failures + 1 : 0)
  }
  return result
}

async function readPageSource(
  browser: WebdriverIO.Browser
): Promise<string | undefined> {
  try {
    return await browser.getPageSource()
  } catch (err) {
    console.warn(
      `@wdio/elements: could not read the page source: ${(err as Error).message}`
    )
    return undefined
  }
}

async function collectNative(
  snapshot: WdioSnapshotModule,
  browser: WebdriverIO.Browser,
  platform: NativePlatform,
  viewport: boolean
): Promise<{ tree: SnapshotNode; refs: SnapshotRef[] } | undefined> {
  const [xml, size] = await Promise.all([
    readPageSource(browser),
    viewport ? safeCall(() => browser.getWindowSize()) : undefined
  ])
  if (!xml) {
    return undefined
  }
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
