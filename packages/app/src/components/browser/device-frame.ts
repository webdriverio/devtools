// The player's frame for a capture that came off a device. A native session has
// no browser window and no url, so the desktop chrome — traffic lights and an
// address bar reading `unknown` — describes nothing, and a landscape frame
// leaves a portrait capture as a narrow strip in the middle of it.
//
// Kept out of snapshot.ts (already over the file cap) so the geometry is a pure
// function the specs can measure without a browser.

import type { DeviceInfo, ImageSize } from '@wdio/devtools-shared'
import { deviceLabel } from '@wdio/devtools-shared'
import { html, type nothing, type TemplateResult } from 'lit'

/**
 * Padding plus border across one axis. Both come out of the size set on a
 * border-box element, so a frame sized without the border hands its capture an
 * area smaller than the one it was fitted for.
 */
export function edgeInset(
  style: CSSStyleDeclaration,
  from: 'Left' | 'Top',
  to: 'Right' | 'Bottom'
): number {
  const read = (value: string) => parseFloat(value || '0') || 0
  return (
    read(style[`padding${from}` as 'paddingLeft']) +
    read(style[`padding${to}` as 'paddingRight']) +
    read(style[`border${from}Width` as 'borderLeftWidth']) +
    read(style[`border${to}Width` as 'borderRightWidth'])
  )
}

/** What the frame spends on itself before the capture gets any room. */
export interface FrameChrome {
  /** Height of the frame's header — furniture above the capture. */
  headerHeight: number
  /** The frame's own horizontal padding and border. */
  insetX: number
  /** The frame's own vertical padding and border. */
  insetY: number
}

/**
 * Size for a frame holding `capture`, so the frame is the shape of the device
 * rather than of the pane. Derived from the capture's own decoded pixels: the
 * metadata viewport cannot serve, because it disagrees with the screenshot on
 * both mobile platforms — Android reports the window without the navigation
 * bar, and iOS reports points, so an older binary on an iPhone 17 says 390x844
 * of a 402x874 screen.
 *
 * The frame's own furniture is taken off before fitting and added back after.
 * Fitting the whole frame to the capture instead leaves the capture AREA short
 * by the header and the padding, so the image letterboxes inside a frame that
 * was supposed to be its shape.
 */
export function deviceFrameSize(
  pane: { width: number; height: number },
  capture: ImageSize,
  chrome: FrameChrome
): { width: number; height: number } {
  const usableWidth = pane.width - chrome.insetX
  const usableHeight = pane.height - chrome.insetY - chrome.headerHeight
  if (
    !capture.width ||
    !capture.height ||
    usableWidth <= 0 ||
    usableHeight <= 0
  ) {
    return { width: pane.width, height: pane.height }
  }
  const scale = Math.min(
    usableWidth / capture.width,
    usableHeight / capture.height
  )
  return {
    width: Math.round(capture.width * scale) + chrome.insetX,
    height:
      Math.round(capture.height * scale) + chrome.headerHeight + chrome.insetY
  }
}

/**
 * The frame's header for a device capture: what it was recorded on, in place of
 * window furniture that does not apply. Keeps the view-toggle slot, which is
 * how the Snapshot/Screencast switch stays reachable.
 */
export function renderDeviceChrome(
  device: DeviceInfo,
  viewToggle: TemplateResult | typeof nothing
): TemplateResult {
  return html`
    <header
      class="device-chrome flex items-center mx-2 bg-sideBarBackground rounded-t-[14px]"
    >
      <span class="device-label truncate" title=${deviceLabel(device)}
        >${deviceLabel(device)}</span
      >
      ${viewToggle}
    </header>
  `
}
