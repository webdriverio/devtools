import {
  attachSelectors,
  collectWeb,
  formatSnapshot,
  inViewport,
  nativePlatform,
  parseNativeSource
} from '@wdio/snapshot'
import type { NativePlatform, SnapshotNode, SnapshotRef } from '@wdio/snapshot'

export interface GetSnapshotOptions {
  /** Only include what intersects the viewport (default false: the full page). */
  viewport?: boolean
}

export interface GetSnapshotResult {
  /** Accessibility tree as text, one `eN` ref per actionable element, each ending in `→ <selector>`. */
  text: string
  refs: SnapshotRef[]
}

const frameHint = (ref: string) => `wdio session frame ${ref}`

const NATIVE_PLATFORMS = new Set(['android', 'ios', 'mac', 'windows'])

// @wdio/session's `classify`: a browserName makes a mobile session web. Desktop
// browsers also report mac/windows here, which their browserName excludes too.
function nativePlatformName(caps: Record<string, unknown>): string | undefined {
  const platformName = String(
    caps.platformName ?? caps['appium:platformName'] ?? ''
  ).toLowerCase()
  return NATIVE_PLATFORMS.has(platformName) && !caps.browserName
    ? platformName
    : undefined
}

/**
 * Same text as `wdio session snapshot --selectors [--viewport]`, for web and
 * native sessions alike. Throws SnapshotError rather than returning a partial tree.
 */
export async function getSnapshot(
  browser: WebdriverIO.Browser,
  options: GetSnapshotOptions = {}
): Promise<GetSnapshotResult> {
  const { viewport = false } = options
  const caps = browser.capabilities as Record<string, unknown>
  const platformName = nativePlatformName(caps)
  const { tree, refs } = platformName
    ? await collectNative(browser, nativePlatform(caps, platformName), viewport)
    : await collectWebTree(browser, viewport)

  attachSelectors(tree, refs)
  return {
    text: formatSnapshot(tree, { selectors: true, frameHint }),
    refs
  }
}

async function collectWebTree(browser: WebdriverIO.Browser, viewport: boolean) {
  return collectWeb(
    browser,
    { counter: 0, all: false, boxes: false, viewport, assignRefs: 'ephemeral' },
    // Same rule as collectTop in @wdio/session; `bidi` is the path for a classic session.
    { transport: browser.isBidi ? 'classic-first' : 'bidi' }
  )
}

async function collectNative(
  browser: WebdriverIO.Browser,
  platform: NativePlatform,
  viewport: boolean
): Promise<{ tree: SnapshotNode; refs: SnapshotRef[] }> {
  const [xml, size] = await Promise.all([
    browser.getPageSource(),
    viewport ? browser.getWindowSize() : undefined
  ])
  const parsed = parseNativeSource(xml, platform, { all: false, counter: 0 })
  if (!size) {
    return parsed
  }
  const tree = inViewport(parsed.tree, size.width, size.height) ?? parsed.tree
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
