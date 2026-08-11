import '@components/sidebar/test-suite.js'
import type {
  ExplorerTestEntry,
  ExplorerTestSuite
} from '@components/sidebar/test-suite.js'
import type { TestRunDetail } from '@components/sidebar/types.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import { entryProps, mixedStateRun, nestedRun, rowProps } from '../fixtures.js'
import type { NamedSuite, NamedTest, TestEntryProps } from '../fixtures.js'

const SUITE = 'wdio-test-suite'
const ENTRY = 'wdio-test-entry'
const GROUP_SLOT = 'slot:not([name])'
const CHILDREN_SLOT = 'slot[name="children"]'
const LABEL_SLOT = 'slot[name="label"]'
const LABEL_SPAN = 'section.row > span'
const CHEVRON_BUTTON = 'section.row > button'
const RUN_BUTTON = 'nav.row-actions button:has(icon-mdi-play)'

const assigned = (host: Element, selector: string): Element[] =>
  shadow<HTMLSlotElement>(host, selector)?.assignedElements() ?? []

const uidsOf = (rows: Element[]) =>
  rows.map((entry) => (entry as ExplorerTestEntry).uid)

function buildRow(props: TestEntryProps, label?: string): ExplorerTestEntry {
  const resolved = entryProps(props)
  const entry = document.createElement(ENTRY)
  Object.assign(entry, resolved)
  const title = document.createElement('label')
  title.slot = 'label'
  title.textContent = label ?? resolved.labelText ?? ''
  entry.append(title)
  return entry
}

/** One row per fragment, with its state, type and label derived by the same
 *  helpers the explorer uses — the group specs assert composition, so their
 *  rows should be the rows the explorer would hand them. */
const rowFor = (fragment: NamedSuite | NamedTest): ExplorerTestEntry =>
  buildRow(rowProps(fragment))

/** Nest a group in a row's `children` slot the way the explorer does for a
 *  suite that has descendants. */
function groupUnder(
  parent: ExplorerTestEntry,
  rows: ExplorerTestEntry[]
): ExplorerTestSuite {
  const group = document.createElement(SUITE)
  group.slot = 'children'
  group.append(...rows)
  parent.hasChildren = true
  parent.append(group)
  return group
}

/** Every descendant has to finish its own first render — awaiting the group
 *  alone resolves before the rows it was just handed have rendered. */
async function mountGroup(
  rows: ExplorerTestEntry[]
): Promise<ExplorerTestSuite> {
  const group = await mount<ExplorerTestSuite>(SUITE)
  group.append(...rows)
  await settle(group)
  for (const nested of Array.from(group.querySelectorAll(SUITE))) {
    await settle(nested)
  }
  for (const entry of Array.from(group.querySelectorAll(ENTRY))) {
    await settle(entry)
  }
  return group
}

function capture<T>(
  target: EventTarget,
  type: string,
  act: () => void
): CustomEvent<T>[] {
  const received: CustomEvent<T>[] = []
  const listener = (event: Event) => received.push(event as CustomEvent<T>)
  target.addEventListener(type, listener)
  try {
    act()
  } finally {
    target.removeEventListener(type, listener)
  }
  return received
}

const checkoutRows = () => [
  rowFor(mixedStateRun.passing),
  rowFor(mixedStateRun.failing),
  rowFor(mixedStateRun.running),
  rowFor(mixedStateRun.skipped)
]

/** The shape the explorer builds for a suite with descendants: a row whose
 *  `children` slot holds its own group. */
const nestedTree = () => {
  const tests = [
    rowFor(nestedRun.signsIn),
    rowFor(nestedRun.rejectsBadPassword)
  ]
  const scenario = rowFor(nestedRun.scenario)
  const inner = groupUnder(scenario, tests)
  return { tests, scenario, inner }
}

describe('wdio-test-suite', () => {
  describe('grouping', () => {
    it('projects its rows in the order they were added', async () => {
      const rows = checkoutRows()
      const group = await mountGroup(rows)

      const projected = assigned(group, GROUP_SLOT)
      expect(projected).toHaveLength(4)
      expect(uidsOf(projected)).toEqual([
        mixedStateRun.passing.uid,
        mixedStateRun.failing.uid,
        mixedStateRun.running.uid,
        mixedStateRun.skipped.uid
      ])
      expect(projected[0]).toBe(rows[0])
      expect(projected[3]).toBe(rows[3])
    })

    it('projects every row title through the row that owns it', async () => {
      const group = await mountGroup(checkoutRows())

      // Read back through each row's OWN label slot rather than off the `<label>`
      // the fixture appended: the group renders a bare slot, so a light-DOM query
      // would only echo the fixture's write and pass even if nothing projected.
      const projected = assigned(group, GROUP_SLOT)
      expect(projected).toHaveLength(4)
      expect(
        projected.map((row) => assigned(row, LABEL_SLOT).map(text).join('|'))
      ).toEqual([
        mixedStateRun.passing.title,
        mixedStateRun.failing.title,
        mixedStateRun.running.title,
        mixedStateRun.skipped.title
      ])
    })

    it('adds no chrome of its own around the rows', async () => {
      const group = await mountGroup(checkoutRows())

      expect(shadowAll(group, GROUP_SLOT)).toHaveLength(1)
      expect(group.shadowRoot?.querySelectorAll('button').length).toBe(0)
      // The slot's own text is its fallback content: the group renders none.
      expect(text(shadow(group, GROUP_SLOT))).toBe('')
    })

    it('renders an empty group when it holds no rows', async () => {
      const group = await mountGroup([])

      // The slot has to EXIST and be empty. Asserting only that nothing is
      // assigned would also hold for a group that rendered no slot at all — the
      // state in which every row it is handed disappears.
      const slot = shadow<HTMLSlotElement>(group, GROUP_SLOT)
      expect(slot).not.toBe(null)
      expect(slot?.assignedNodes()).toHaveLength(0)
      expect(group.querySelectorAll(ENTRY).length).toBe(0)
    })
  })

  describe('nesting', () => {
    it("nests a suite's own group inside its row", async () => {
      const { scenario, inner, tests } = nestedTree()
      await mountGroup([scenario])

      expect(assigned(scenario, CHILDREN_SLOT)[0]).toBe(inner)
      expect(uidsOf(assigned(inner, GROUP_SLOT))).toEqual([
        nestedRun.signsIn.uid,
        nestedRun.rejectsBadPassword.uid
      ])
      expect(assigned(inner, GROUP_SLOT)[0]).toBe(tests[0])
    })

    it('keeps each group with the row that owns it', async () => {
      const first = nestedTree()
      const second = nestedTree()
      second.scenario.uid = `${nestedRun.scenario.uid}-2`
      await mountGroup([first.scenario, second.scenario])

      expect(assigned(first.scenario, CHILDREN_SLOT)[0]).toBe(first.inner)
      expect(assigned(second.scenario, CHILDREN_SLOT)[0]).toBe(second.inner)
      expect(assigned(first.inner, GROUP_SLOT)[0]).toBe(first.tests[0])
      expect(assigned(second.inner, GROUP_SLOT)[0]).toBe(second.tests[0])
    })

    it('hides the whole group when its parent row collapses', async () => {
      const { scenario, inner } = nestedTree()
      await mountGroup([scenario])
      const section = shadow(scenario, CHILDREN_SLOT)?.parentElement
      expect(section?.classList.contains('hidden')).toBe(false)

      shadow(scenario, CHEVRON_BUTTON)?.click()
      await settle(scenario)

      expect(assigned(scenario, CHILDREN_SLOT)[0]).toBe(inner)
      expect(
        shadow(scenario, CHILDREN_SLOT)?.parentElement?.classList.contains(
          'hidden'
        )
      ).toBe(true)
    })
  })

  describe('event delegation', () => {
    it("lets a row's selection reach a listener above the group", async () => {
      const rows = checkoutRows()
      const group = await mountGroup(rows)

      const received = capture<string>(group, 'app-test-select', () =>
        shadow(rows[1], LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toBe(mixedStateRun.failing.uid)
    })

    it("lets a row's run request reach a listener above the group", async () => {
      const rows = checkoutRows()
      const group = await mountGroup(rows)

      const received = capture<TestRunDetail>(group, 'app-test-run', () =>
        shadow(rows[0], RUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.uid).toBe(mixedStateRun.passing.uid)
    })

    it('carries a run request out of a nested group as well', async () => {
      const { scenario, tests } = nestedTree()
      const group = await mountGroup([scenario])

      const received = capture<TestRunDetail>(group, 'app-test-run', () =>
        shadow(tests[0], RUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.uid).toBe(nestedRun.signsIn.uid)
    })

    it("carries a row's collapse change up to the group", async () => {
      const { scenario } = nestedTree()
      const group = await mountGroup([scenario])

      const received = capture<{ isCollapsed: boolean; entry: Element }>(
        group,
        'entry-collapse-change',
        () => shadow(scenario, CHEVRON_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.isCollapsed).toBe(true)
      expect(received[0]?.detail.entry).toBe(scenario)
    })
  })
})
