import { describe, expect, it } from 'vitest'

import {
  deviceFrameSize,
  edgeInset
} from '../src/components/browser/device-frame.js'

/** The capture from the issue's measurement, and a Pixel 7 for the other shape. */
const IPHONE = { width: 1170, height: 2532 }
const PIXEL = { width: 1080, height: 2400 }
/** The player's own furniture: a header, and the frame's 0.5rem padding. */
const CHROME = { headerHeight: 40, insetX: 16, insetY: 16 }
const BARE = { headerHeight: 0, insetX: 0, insetY: 0 }

/** Shape of the box the capture actually gets, which is the point of all this. */
const captureShape = (
  frame: { width: number; height: number },
  chrome = CHROME
) =>
  (frame.width - chrome.insetX) /
  (frame.height - chrome.headerHeight - chrome.insetY)

describe('deviceFrameSize', () => {
  it('gives the capture a box of its own shape, not the pane’s', () => {
    // The measured case: a 388px-wide landscape pane left the image using
    // 162px, the rest backdrop, because the frame was the pane's shape.
    const frame = deviceFrameSize({ width: 388, height: 420 }, IPHONE, CHROME)

    // Precision 2: the width is rounded to a whole pixel, which on a ~150px
    // frame moves the ratio by ~0.0005.
    expect(captureShape(frame)).toBeCloseTo(IPHONE.width / IPHONE.height, 2)
    // Height-bound here, so the frame is only as wide as the capture needs —
    // far narrower than the 388px pane it used to span.
    expect(frame.height).toBe(420)
    expect(frame.width).toBeLessThan(200)
  })

  it('takes the furniture off before fitting and adds it back after', () => {
    const framed = deviceFrameSize({ width: 1000, height: 400 }, PIXEL, CHROME)
    const bare = deviceFrameSize(
      {
        width: 1000 - CHROME.insetX,
        height: 400 - CHROME.insetY - CHROME.headerHeight
      },
      PIXEL,
      BARE
    )

    // Same capture area either way: the header and padding are spent on top of
    // the capture's box, not taken out of it.
    expect(framed.width - CHROME.insetX).toBe(bare.width)
    expect(framed.height - CHROME.headerHeight - CHROME.insetY).toBe(
      bare.height
    )
  })

  it('is bounded by the width when that is what constrains it', () => {
    const frame = deviceFrameSize({ width: 136, height: 4000 }, PIXEL, CHROME)

    expect(frame.width).toBe(136)
    expect(captureShape(frame)).toBeCloseTo(PIXEL.width / PIXEL.height, 2)
  })

  it('keeps a landscape capture landscape', () => {
    const frame = deviceFrameSize(
      { width: 816, height: 856 },
      { width: 1280, height: 800 },
      CHROME
    )

    expect(frame.width).toBe(816)
    expect(captureShape(frame)).toBeCloseTo(1280 / 800, 2)
  })

  it('falls back to the whole pane when there is nothing to fit', () => {
    expect(
      deviceFrameSize(
        { width: 400, height: 300 },
        { width: 0, height: 0 },
        CHROME
      )
    ).toEqual({ width: 400, height: 300 })
    // A pane with no room left once the furniture is paid for.
    expect(
      deviceFrameSize(
        { width: 400, height: CHROME.headerHeight },
        IPHONE,
        CHROME
      )
    ).toEqual({ width: 400, height: CHROME.headerHeight })
    expect(
      deviceFrameSize({ width: CHROME.insetX, height: 900 }, IPHONE, CHROME)
    ).toEqual({ width: CHROME.insetX, height: 900 })
  })
})

/**
 * The section is `box-sizing: border-box` with a 2px border, so the border
 * comes out of the size set on it exactly as the padding does. Covered here
 * rather than in the component spec: the harness does not apply the Tailwind
 * utility that draws that border, so it measures 0px there and cannot tell a
 * frame that accounts for it from one that does not.
 */
describe('edgeInset', () => {
  /** Only the longhands `edgeInset` reads — a real declaration carries ~340. */
  const style = (values: Record<string, string>) =>
    values as unknown as CSSStyleDeclaration

  it('sums padding and border across the axis', () => {
    const declaration = style({
      paddingLeft: '8px',
      paddingRight: '8px',
      borderLeftWidth: '2px',
      borderRightWidth: '2px'
    })

    // 16 of padding + 4 of border. Reading padding alone left the capture area
    // 4px short per axis and letterboxed it inside its own frame.
    expect(edgeInset(declaration, 'Left', 'Right')).toBe(20)
  })

  it('reads the vertical axis from the vertical longhands', () => {
    const declaration = style({
      paddingTop: '8px',
      paddingBottom: '4px',
      borderTopWidth: '2px',
      borderBottomWidth: '1px'
    })

    expect(edgeInset(declaration, 'Top', 'Bottom')).toBe(15)
  })

  it('treats an absent or non-numeric edge as zero', () => {
    expect(edgeInset(style({}), 'Left', 'Right')).toBe(0)
    // A computed border-width reads `medium` when the style is `none`.
    expect(
      edgeInset(
        style({ paddingLeft: '8px', borderLeftWidth: 'medium' }),
        'Left',
        'Right'
      )
    ).toBe(8)
  })
})
