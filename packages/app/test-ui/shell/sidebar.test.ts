import type { Metadata } from '@wdio/devtools-shared'

import { metadataContext, suiteContext } from '@/controller/context.js'
import type { SuiteStatsFragment } from '@/controller/types.js'
import '@components/sidebar.js'
import type { DevtoolsSidebar } from '@components/sidebar.js'
import type { DevtoolsSidebarExplorer } from '@components/sidebar/explorer.js'
import type { DevtoolsSidebarFilter } from '@components/sidebar/filter.js'
import type { DevtoolsSidebarSummary } from '@components/sidebar/summary.js'
import type { ExplorerTestEntry } from '@components/sidebar/test-suite.js'
import {
  computeSuiteSummary,
  deriveRunStatus
} from '@components/sidebar/suite-summary.js'

import { mount, mountWithContext, settle } from '../support/mount.js'
import type { ContextValue } from '../support/mount.js'
import { shadow, shadowAll, text, texts } from '../support/queries.js'
import { loginRun, testrunnerMetadata } from './fixtures.js'

const SIDEBAR = 'wdio-devtools-sidebar'
const TOP = '.top'
const FILTER = 'wdio-devtools-sidebar-filter'
const SUMMARY = 'wdio-devtools-sidebar-summary'
const EXPLORER = 'wdio-devtools-sidebar-explorer'
const QUERY_INPUT = 'input[name="filter"]'
const STATUS_PILL = '.pill'
const PASSED_COUNT = '.count'
const PROGRESS_PASSED = '.seg-passed'
const PROGRESS_FAILED = '.seg-failed'
const PROGRESS_RUNNING = '.seg-running'
const FAILED_CHIP = '.legend button.failed'
const ROW = 'wdio-test-entry'
const ROW_LABEL = 'wdio-test-entry > label'
const EMPTY_STATE = 'p.text-disabledForeground'

/** The counts the sidebar is expected to show, taken from the same helper the
 *  summary renders with rather than restated. */
const SUMMARY_OF_RUN = computeSuiteSummary(loginRun.frame)

interface SidebarParts {
  sidebar: DevtoolsSidebar
  filter: DevtoolsSidebarFilter
  summary: DevtoolsSidebarSummary
  explorer: DevtoolsSidebarExplorer
}

function part<T extends Element>(sidebar: DevtoolsSidebar, tag: string): T {
  const el = shadow<T>(sidebar, tag)
  if (!el) {
    throw new Error(`the sidebar rendered no ${tag}`)
  }
  return el
}

/** Every child renders in its own update cycle, so each has to settle before
 *  its shadow content is there to assert. */
async function mountSidebar(
  registry?: Record<string, SuiteStatsFragment>[],
  metadata: Metadata = testrunnerMetadata
): Promise<SidebarParts> {
  const contexts: ContextValue[] = [
    { context: metadataContext, value: metadata }
  ]
  if (registry) {
    contexts.push({ context: suiteContext, value: registry })
  }
  const sidebar = await mountWithContext<DevtoolsSidebar>(SIDEBAR, contexts)
  await settle(sidebar)
  const parts: SidebarParts = {
    sidebar,
    filter: part<DevtoolsSidebarFilter>(sidebar, FILTER),
    summary: part<DevtoolsSidebarSummary>(sidebar, SUMMARY),
    explorer: part<DevtoolsSidebarExplorer>(sidebar, EXPLORER)
  }
  await settleTree(parts)
  return parts
}

async function settleTree(parts: SidebarParts): Promise<void> {
  await settle(parts.filter)
  await settle(parts.summary)
  await settle(parts.explorer)
  for (const row of shadowAll<ExplorerTestEntry>(parts.explorer, ROW)) {
    await settle(row)
  }
}

/** Type into the real filter field — the sidebar's own child — rather than
 *  dispatching the event it emits. */
async function typeFilter(parts: SidebarParts, query: string): Promise<void> {
  const input = shadow<HTMLInputElement>(parts.filter, QUERY_INPUT)
  if (!input) {
    throw new Error('the filter rendered no query input')
  }
  input.value = query
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
  await settleTree(parts)
}

const rowLabels = (parts: SidebarParts) => texts(parts.explorer, ROW_LABEL)

const widthOf = (host: Element, selector: string) =>
  shadow<HTMLElement>(host, selector)?.style.width

const pct = (n: number) => `${(n / SUMMARY_OF_RUN.total) * 100}%`

describe('wdio-devtools-sidebar', () => {
  describe('composition', () => {
    it('renders the filter and the summary above the test tree', async () => {
      const { sidebar } = await mountSidebar(loginRun.frame)

      const structure = [...(sidebar.shadowRoot?.children ?? [])]
        .filter((el) => el.tagName !== 'STYLE')
        .map((el) => el.tagName.toLowerCase())
      expect(structure).toEqual(['div', EXPLORER])
      expect(
        shadowAll(sidebar, `${TOP} > *`).map((el) => el.tagName.toLowerCase())
      ).toEqual([FILTER, SUMMARY])
    })

    it('renders exactly one of each child', async () => {
      const { sidebar } = await mountSidebar(loginRun.frame)

      expect(shadowAll(sidebar, FILTER)).toHaveLength(1)
      expect(shadowAll(sidebar, SUMMARY)).toHaveLength(1)
      expect(shadowAll(sidebar, EXPLORER)).toHaveLength(1)
    })

    it('keeps the filter field on screen before any run data arrives', async () => {
      const { sidebar, filter, summary, explorer } = await mountSidebar()

      expect(shadowAll(filter, QUERY_INPUT)).toHaveLength(1)
      // No registry at all: the summary has nothing to total and the explorer
      // has no tree, so both render empty inside a sidebar that still stands.
      expect(summary.shadowRoot?.querySelector(STATUS_PILL)).toBe(null)
      expect(shadowAll(explorer, 'header')).toHaveLength(0)
      expect(shadowAll(sidebar, TOP)).toHaveLength(1)
    })

    it('shows the tree empty state once the registry arrives with no suites', async () => {
      const { summary, explorer } = await mountSidebar([])

      expect(text(shadow(explorer, EMPTY_STATE))).toBe('No tests to display')
      expect(summary.shadowRoot?.querySelector(STATUS_PILL)).toBe(null)
    })
  })

  describe('run data', () => {
    it('tallies the run in the summary', async () => {
      const { summary } = await mountSidebar(loginRun.frame)

      expect(text(shadow(summary, PASSED_COUNT))).toBe(
        `${SUMMARY_OF_RUN.passed}/${SUMMARY_OF_RUN.total} passed`
      )
      expect(text(shadow(summary, PASSED_COUNT))).toBe('1/4 passed')
    })

    it('reports the headline run state while a test is still running', async () => {
      const { summary } = await mountSidebar(loginRun.frame)

      expect(summary.getAttribute('data-status')).toBe(
        deriveRunStatus(SUMMARY_OF_RUN)
      )
      expect(text(shadow(summary, STATUS_PILL))).toBe('Running')
    })

    it('sizes the progress segments to the per-state counts', async () => {
      const { summary } = await mountSidebar(loginRun.frame)

      expect(widthOf(summary, PROGRESS_PASSED)).toBe(pct(SUMMARY_OF_RUN.passed))
      expect(widthOf(summary, PROGRESS_FAILED)).toBe(pct(SUMMARY_OF_RUN.failed))
      expect(widthOf(summary, PROGRESS_RUNNING)).toBe(
        pct(SUMMARY_OF_RUN.running)
      )
      expect(widthOf(summary, PROGRESS_PASSED)).toBe('25%')
    })

    it('renders the suite and its tests in the explorer', async () => {
      const parts = await mountSidebar(loginRun.frame)

      expect(rowLabels(parts)).toEqual(loginRun.rowLabels)
    })
  })

  describe('filter reaches the tree', () => {
    it('narrows the tree to what the filter field matches', async () => {
      const parts = await mountSidebar(loginRun.frame)

      await typeFilter(parts, 'flash')

      expect(rowLabels(parts)).toEqual([
        loginRun.suite.title,
        loginRun.failing.title
      ])
    })

    it('restores the whole tree when the field is emptied', async () => {
      const parts = await mountSidebar(loginRun.frame)

      await typeFilter(parts, 'flash')
      await typeFilter(parts, '')

      expect(rowLabels(parts)).toEqual(loginRun.rowLabels)
    })

    it('leaves the summary totals alone while the tree is filtered', async () => {
      const parts = await mountSidebar(loginRun.frame)

      await typeFilter(parts, 'flash')

      // The summary counts the run, not the visible rows.
      expect(text(shadow(parts.summary, PASSED_COUNT))).toBe('1/4 passed')
    })
  })

  describe('summary reaches the tree', () => {
    it('narrows the tree to the status chip that was pressed', async () => {
      const parts = await mountSidebar(loginRun.frame)

      shadow(parts.summary, FAILED_CHIP)?.click()
      await settleTree(parts)

      expect(rowLabels(parts)).toEqual([
        loginRun.suite.title,
        loginRun.failing.title
      ])
      expect(
        shadow(parts.summary, FAILED_CHIP)?.getAttribute('aria-pressed')
      ).toBe('true')
    })

    it('restores the whole tree when the chip is pressed again', async () => {
      const parts = await mountSidebar(loginRun.frame)

      shadow(parts.summary, FAILED_CHIP)?.click()
      await settleTree(parts)
      shadow(parts.summary, FAILED_CHIP)?.click()
      await settleTree(parts)

      expect(rowLabels(parts)).toEqual(loginRun.rowLabels)
      expect(
        shadow(parts.summary, FAILED_CHIP)?.getAttribute('aria-pressed')
      ).toBe('false')
    })
  })

  describe('without a provider', () => {
    it('still renders its three children when nothing provides context', async () => {
      const sidebar = await mount<DevtoolsSidebar>(SIDEBAR)

      expect(shadowAll(sidebar, FILTER)).toHaveLength(1)
      expect(shadowAll(sidebar, SUMMARY)).toHaveLength(1)
      expect(shadowAll(sidebar, EXPLORER)).toHaveLength(1)
    })
  })
})
