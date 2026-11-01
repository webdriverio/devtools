// The geometry a trace is replayed at.
//
// `metadata.viewport` is not descriptive: `trace-exporter` falls back to a
// hard-coded 1280x720 when it is absent, and the player lays the DOM-replay
// iframe out at whatever it finds. An adapter that publishes none therefore
// frames every run — desktop included — at proportions it never had.
//
// Two reads, because only one of them exists at a time: a page measures itself
// through `visualViewport`, and a native app has no page to ask, so the
// device's own window is the only answer. `isNativeAppSession` settles which.

import { isNativeAppSession, type Viewport } from '@wdio/devtools-shared'

/**
 * A function BODY, which is what every driver's script endpoint takes.
 *
 * Reads the fields one by one rather than returning `window.visualViewport`
 * itself: it is a host object, and a driver that serializes it structurally
 * hands back `{}` — the richer read then looks like a successful empty one.
 */
export const VISUAL_VIEWPORT_SCRIPT = `
  var v = window.visualViewport
  if (!v) { return null }
  return {
    width: v.width,
    height: v.height,
    offsetLeft: v.offsetLeft,
    offsetTop: v.offsetTop,
    scale: v.scale
  }
`

export interface ViewportProbes {
  /** Runs a function body in the page. Omitted when the adapter has no way to. */
  runScript?: (body: string) => Promise<unknown>
  /** The device or OS window — the native session's only measurable surface. */
  getWindowSize?: () => Promise<unknown>
  onWarn?: (message: string) => void
}

const size = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined

/** A window rect carries no scale or offset — a native app is not scrolled or
 *  pinch-zoomed, so the neutral values are the true ones rather than padding. */
function fromWindow(raw: unknown): Viewport | undefined {
  const rect = raw as { width?: unknown; height?: unknown } | undefined
  const width = size(rect?.width)
  const height = size(rect?.height)
  return width && height
    ? { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 }
    : undefined
}

function fromVisualViewport(raw: unknown): Viewport | undefined {
  const v = raw as Record<string, unknown> | undefined
  const width = size(v?.width)
  const height = size(v?.height)
  if (!width || !height) {
    return undefined
  }
  return {
    width,
    height,
    offsetLeft: typeof v?.offsetLeft === 'number' ? v.offsetLeft : 0,
    offsetTop: typeof v?.offsetTop === 'number' ? v.offsetTop : 0,
    scale: size(v?.scale) ?? 1
  }
}

/**
 * The session's viewport, or undefined when it cannot be read.
 *
 * Degrades rather than throwing: a capture without geometry is still worth
 * keeping, and this runs while the session is being brought up.
 */
export async function resolveViewport(
  capabilities: unknown,
  probes: ViewportProbes
): Promise<Viewport | undefined> {
  const native = isNativeAppSession(capabilities)
  try {
    if (native) {
      return probes.getWindowSize
        ? fromWindow(await probes.getWindowSize())
        : undefined
    }
    return probes.runScript
      ? fromVisualViewport(await probes.runScript(VISUAL_VIEWPORT_SCRIPT))
      : undefined
  } catch (err) {
    probes.onWarn?.(
      `Could not resolve the session viewport: ${(err as Error).message}`
    )
    return undefined
  }
}
