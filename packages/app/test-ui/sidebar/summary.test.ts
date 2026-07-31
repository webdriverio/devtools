import '@components/sidebar/summary.js'
import type { DevtoolsSidebarSummary } from '@components/sidebar/summary.js'
import type {
  StatusFilterDetail,
  TestStatus
} from '@components/sidebar/types.js'
import { suiteContext } from '@/controller/context.js'
import type { SuiteStatsFragment } from '@/controller/types.js'

import { mount, mountWithContext, settle } from '../support/mount.js'
import { shadow, shadowAll, text, texts } from '../support/queries.js'
import {
  mixedStateRun,
  nestedRun,
  profileSuite,
  suiteFragment,
  suiteRegistry,
  summaryRun
} from './fixtures.js'

const TAG = 'wdio-devtools-sidebar-summary'
const CARD = '.card'
const PILL = '.pill'
const COUNT = '.count'
const SEGMENT = '.progress > span'
const CHIP = '.legend button'

const mountSummary = (registry: Record<string, SuiteStatsFragment>[]) =>
  mountWithContext<DevtoolsSidebarSummary>(TAG, [
    { context: suiteContext, value: registry }
  ])

const segmentWidths = (el: Element) =>
  shadowAll<HTMLElement>(el, SEGMENT).map((segment) => segment.style.width)

const pressed = (el: Element) =>
  shadowAll(el, CHIP).map((chip) => chip.getAttribute('aria-pressed'))

function chip(el: Element, status: string): HTMLElement {
  const button = shadow<HTMLElement>(el, `${CHIP}.${status}`)
  if (!button) {
    throw new Error(`no legend chip rendered for "${status}"`)
  }
  return button
}

/** The chips broadcast on `window`, the way the explorer receives them. */
function captureStatusFilter(act: () => void): (TestStatus | null)[] {
  const received: (TestStatus | null)[] = []
  const listener = (event: Event) =>
    received.push((event as CustomEvent<StatusFilterDetail>).detail.status)
  window.addEventListener('app-status-filter', listener)
  try {
    act()
  } finally {
    window.removeEventListener('app-status-filter', listener)
  }
  return received
}

describe('wdio-devtools-sidebar-summary', () => {
  describe('counts', () => {
    it("reports how many of the run's tests have passed", async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(text(shadow(el, COUNT))).toBe('1/4 passed')
    })

    it('counts skipped tests in the total but not in the passed tally', async () => {
      const el = await mountSummary(summaryRun('passed', 'skipped'))

      expect(text(shadow(el, COUNT))).toBe('1/2 passed')
    })

    it('counts the tests of a nested suite once', async () => {
      const el = await mountSummary(nestedRun.registry)

      expect(text(shadow(el, COUNT))).toBe('2/2 passed')
    })

    it('counts a suite delivered in two registry chunks once', async () => {
      const el = await mountSummary([
        ...mixedStateRun.registry,
        ...mixedStateRun.registry
      ])

      expect(text(shadow(el, COUNT))).toBe('1/4 passed')
    })
  })

  describe('run status', () => {
    it('reports a run with a test still executing as running', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(text(shadow(el, PILL))).toBe('Running')
      expect(el.getAttribute('data-status')).toBe('running')
    })

    it('reports a queued test after a finished one as a run still in progress', async () => {
      const el = await mountSummary(summaryRun('passed', undefined))

      expect(text(shadow(el, PILL))).toBe('Running')
      expect(el.getAttribute('data-status')).toBe('running')
    })

    it('reports a finished run carrying a failure as failed', async () => {
      const el = await mountSummary(summaryRun('passed', 'failed'))

      expect(text(shadow(el, PILL))).toBe('Failed')
      expect(el.getAttribute('data-status')).toBe('failed')
    })

    it('reports an all-passing run as passed', async () => {
      const el = await mountSummary(suiteRegistry(profileSuite))

      expect(text(shadow(el, PILL))).toBe('Passed')
      expect(text(shadow(el, COUNT))).toBe('2/2 passed')
    })

    it('reports a run whose tests have not started yet as idle', async () => {
      const el = await mountSummary(summaryRun(undefined, undefined))

      expect(text(shadow(el, PILL))).toBe('Idle')
      expect(text(shadow(el, COUNT))).toBe('0/2 passed')
    })

    // A run that verified nothing is not a passing run: reporting green off a
    // passed tally of zero was a false green.
    it('reports an all-skipped run as skipped', async () => {
      const el = await mountSummary(summaryRun('skipped', 'skipped'))

      expect(text(shadow(el, PILL))).toBe('Skipped')
      expect(text(shadow(el, COUNT))).toBe('0/2 passed')
    })

    it('tints the card yellow when the run only skipped', async () => {
      const el = await mountSummary(summaryRun('skipped', 'skipped'))

      expect(el.style.getPropertyValue('--status')).toBe(
        'var(--vscode-charts-yellow)'
      )
    })

    it('tints the card blue while the run is in progress', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(el.style.getPropertyValue('--status')).toBe(
        'var(--vscode-charts-blue)'
      )
    })

    it('tints the card red once the run has failed', async () => {
      const el = await mountSummary(summaryRun('failed'))

      expect(el.style.getPropertyValue('--status')).toBe(
        'var(--vscode-charts-red)'
      )
    })
  })

  describe('progress bar', () => {
    it('sizes each segment by its share of the run', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(segmentWidths(el)).toEqual(['25%', '25%', '25%'])
    })

    it('fills the bar for an all-passing run', async () => {
      const el = await mountSummary(suiteRegistry(profileSuite))

      expect(segmentWidths(el)).toEqual(['100%', '0%', '0%'])
    })

    it('leaves the bar empty for a run that only skipped', async () => {
      const el = await mountSummary(summaryRun('skipped', 'skipped'))

      expect(segmentWidths(el)).toEqual(['0%', '0%', '0%'])
    })

    it('leaves the bar empty for a run that has not started', async () => {
      const el = await mountSummary(summaryRun(undefined, undefined))

      expect(segmentWidths(el)).toEqual(['0%', '0%', '0%'])
    })
  })

  describe('status chips', () => {
    it('offers one chip per test status', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(texts(el, CHIP)).toEqual([
        'Passed',
        'Failed',
        'Running',
        'Skipped'
      ])
    })

    it('leaves every chip unpressed until one is picked', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      expect(pressed(el)).toEqual(['false', 'false', 'false', 'false'])
    })

    it('narrows the tree to the status of the chip picked', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      const received = captureStatusFilter(() => chip(el, 'failed').click())

      expect(received).toEqual(['failed'])
    })

    it('marks only the picked chip as pressed', async () => {
      const el = await mountSummary(mixedStateRun.registry)

      chip(el, 'failed').click()
      await settle(el)

      expect(pressed(el)).toEqual(['false', 'true', 'false', 'false'])
    })

    it('clears the filter when the pressed chip is picked again', async () => {
      const el = await mountSummary(mixedStateRun.registry)
      chip(el, 'failed').click()
      await settle(el)

      const received = captureStatusFilter(() => chip(el, 'failed').click())
      await settle(el)

      expect(received).toEqual([null])
      expect(pressed(el)).toEqual(['false', 'false', 'false', 'false'])
    })

    it('moves the filter to the next chip picked', async () => {
      const el = await mountSummary(mixedStateRun.registry)
      chip(el, 'failed').click()
      await settle(el)

      const received = captureStatusFilter(() => chip(el, 'running').click())
      await settle(el)

      expect(received).toEqual(['running'])
      expect(pressed(el)).toEqual(['false', 'false', 'true', 'false'])
    })

    it('filters on a status no test is in', async () => {
      const el = await mountSummary(suiteRegistry(profileSuite))

      const received = captureStatusFilter(() => chip(el, 'failed').click())

      expect(received).toEqual(['failed'])
    })
  })

  describe('nothing to summarise', () => {
    it('renders nothing until the suite registry arrives', async () => {
      const el = await mount<DevtoolsSidebarSummary>(TAG)

      expect(shadowAll(el, CARD)).toHaveLength(0)
      expect(el.hasAttribute('data-status')).toBe(false)
    })

    it('renders nothing for an empty registry', async () => {
      const el = await mountSummary([])

      expect(shadowAll(el, CARD)).toHaveLength(0)
      expect(el.hasAttribute('data-status')).toBe(false)
    })

    it('renders nothing for a suite that holds no tests', async () => {
      const el = await mountSummary(
        suiteRegistry(suiteFragment('empty-suite', 'Reporting', { tests: [] }))
      )

      expect(shadowAll(el, CARD)).toHaveLength(0)
      expect(shadowAll(el, CHIP)).toHaveLength(0)
    })
  })
})
