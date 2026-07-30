import type { CommandLog, TraceActionChild } from '@wdio/devtools-shared'

import {
  actionGroupsContext,
  commandContext,
  mutationContext
} from '@/controller/context.js'
import { activeSpanAt } from '@components/workbench/active-entry.js'
import {
  entryDuration,
  stepDurations
} from '@components/workbench/actionItems/duration.js'
import '@components/workbench/actions.js'
import type { DevtoolsActions } from '@components/workbench/actions.js'

import {
  type ContextValue,
  mountWithContext,
  settle
} from '../../support/mount.js'
import { shadow, shadowAll } from '../../support/queries.js'
import {
  loginActionTree,
  loginTimeline,
  SET_VALUE_PLAYBACK_TIME
} from '../fixtures.js'

const PANEL = 'wdio-devtools-actions'
const COMMAND_ROW = 'wdio-devtools-command-item'
const MUTATION_ROW = 'wdio-devtools-mutation-item'
const GROUP_ROW = 'wdio-devtools-group-item'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const ROWS = '.timeline > *'
const ACTIVE_ROW = '[active]'

type CommandRowElement = HTMLElementTagNameMap[typeof COMMAND_ROW]
type MutationRowElement = HTMLElementTagNameMap[typeof MUTATION_ROW]
type GroupRowElement = HTMLElementTagNameMap[typeof GROUP_ROW]
type TimelineEntry = CommandLog | TraceMutation

const { commands, mutations } = loginTimeline

/**
 * The row order the panel derives: `#sortedEntries` keeps the childList
 * mutations that carry a url, drops the rest, and merges them into the command
 * stream by timestamp. Asserted against the rendered rows first, then reused as
 * the basis for every elapsed/duration expectation below — so those follow the
 * panel's own list rather than a second hand-maintained copy of it.
 */
const mergedOrder: TimelineEntry[] = [
  loginTimeline.url,
  loginTimeline.documentLoad,
  loginTimeline.findInput,
  loginTimeline.setValue,
  loginTimeline.click
]

/** Per-row duration as the panel computes it: the entry's own span when it has
 *  one, else the gap to the next row. */
function durationsFor(entries: TimelineEntry[]): Array<number | undefined> {
  const gaps = stepDurations(entries.map((entry) => entry.timestamp))
  return entries.map((entry, index) => entryDuration(entry, gaps[index]))
}

const elapsedFor = (entries: TimelineEntry[]) =>
  entries.map((entry) => entry.timestamp - entries[0].timestamp)

interface PanelInputs {
  commands?: CommandLog[]
  mutations?: TraceMutation[]
  groups?: TraceActionChild[]
}

async function mountPanel(inputs: PanelInputs = {}): Promise<DevtoolsActions> {
  const contexts: ContextValue[] = [
    { context: commandContext, value: inputs.commands ?? commands },
    { context: mutationContext, value: inputs.mutations ?? mutations }
  ]
  if (inputs.groups) {
    contexts.push({ context: actionGroupsContext, value: inputs.groups })
  }
  const panel = await mountWithContext<DevtoolsActions>(PANEL, contexts)
  await settle(panel)
  return panel
}

const tagsOf = (rows: Element[]) => rows.map((row) => row.tagName.toLowerCase())

const entryOf = (row: Element) =>
  (row as CommandRowElement | MutationRowElement).entry

const durationOf = (row: Element) =>
  (row as CommandRowElement | MutationRowElement).duration

const elapsedOf = (row: Element) =>
  (row as CommandRowElement | MutationRowElement).elapsedTime

const clickRow = (row: Element) => shadow(row, 'button')?.click()

describe('wdio-devtools-actions', () => {
  describe('merged timeline', () => {
    it('orders commands and document loads into a single list by timestamp', async () => {
      const panel = await mountPanel()

      expect(shadowAll(panel, ROWS).map(entryOf)).toEqual(mergedOrder)
    })

    it('orders by timestamp whatever order the two streams arrived in', async () => {
      // Capture order is not timeline order: a spec re-run, a replayed slice or
      // a reversed reader would still have to render the same rows.
      const panel = await mountPanel({
        commands: [...commands].reverse(),
        mutations: [...mutations].reverse()
      })

      expect(shadowAll(panel, ROWS).map(entryOf)).toEqual(mergedOrder)
    })

    it('renders a command row per command and a mutation row per document load', async () => {
      const panel = await mountPanel()

      expect(tagsOf(shadowAll(panel, ROWS))).toEqual([
        COMMAND_ROW,
        MUTATION_ROW,
        COMMAND_ROW,
        COMMAND_ROW,
        COMMAND_ROW
      ])
    })

    it('leaves out mutations that are not document loads', async () => {
      const panel = await mountPanel()

      const mutationRows = shadowAll(panel, MUTATION_ROW)
      expect(mutationRows).toHaveLength(1)
      expect(entryOf(mutationRows[0])).toEqual(loginTimeline.documentLoad)
    })

    it('measures elapsed time from the first entry of the merged list', async () => {
      const panel = await mountPanel()

      // Derived from the merged order, so a baseline taken from the run start or
      // from the first COMMAND (rather than the first row) fails here.
      expect(shadowAll(panel, ROWS).map(elapsedOf)).toEqual(
        elapsedFor(mergedOrder)
      )
      expect(shadowAll(panel, ROWS).map(elapsedOf)).toEqual([
        0, 30, 220, 360, 880
      ])
    })

    it('renders the placeholder while no commands or mutations have arrived', async () => {
      const panel = await mountPanel({ commands: [], mutations: [] })

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, ROWS)).toHaveLength(0)
    })
  })

  describe('row duration', () => {
    it('gives every row the duration the merged timeline derives for it', async () => {
      const panel = await mountPanel()

      // Pins the pairing as well as the values: a row handed its neighbour's gap
      // still renders a plausible badge, and only the whole list catches that.
      expect(shadowAll(panel, ROWS).map(durationOf)).toEqual(
        durationsFor(mergedOrder)
      )
      expect(shadowAll(panel, ROWS).map(durationOf)).toEqual([
        420, 190, 40, 80, 520
      ])
    })

    it("prefers a command's own execution span over the gap to the next entry", async () => {
      const panel = await mountPanel()

      const rows = shadowAll(panel, ROWS)
      // url spans 420ms but is followed by a 30ms gap; setValue spans 80ms and is
      // followed by a 520ms gap.
      expect(durationOf(rows[0])).toBe(420)
      expect(durationOf(rows[3])).toBe(80)
    })

    it('falls back to the gap between entries for rows without a span', async () => {
      const panel = await mountPanel()

      const rows = shadowAll(panel, ROWS)
      expect(durationOf(rows[1])).toBe(190)
      // The last row has no next entry, so it borrows the preceding gap.
      expect(durationOf(rows[4])).toBe(520)
    })
  })

  describe('active row', () => {
    it('marks the clicked command as the only active row', async () => {
      const panel = await mountPanel()

      clickRow(shadowAll(panel, ROWS)[3])
      await settle(panel)

      const active = shadowAll(panel, ACTIVE_ROW)
      expect(active).toHaveLength(1)
      expect(entryOf(active[0])).toEqual(loginTimeline.setValue)
    })

    it('marks the clicked document load as the active row', async () => {
      const panel = await mountPanel()

      clickRow(shadowAll(panel, ROWS)[1])
      await settle(panel)

      const active = shadowAll(panel, ACTIVE_ROW)
      expect(active).toHaveLength(1)
      expect(tagsOf(active)).toEqual([MUTATION_ROW])
      expect(entryOf(active[0])).toEqual(loginTimeline.documentLoad)
    })

    it("announces the clicked command's call source for the source editor", async () => {
      const panel = await mountPanel()

      const tracked = new Promise<string | undefined>((resolve) => {
        window.addEventListener(
          'app-source-track',
          (event) =>
            resolve(
              (event as CustomEvent<{ callSource?: string }>).detail.callSource
            ),
          { once: true }
        )
      })
      clickRow(shadowAll(panel, ROWS)[3])

      expect(await tracked).toBe(loginTimeline.setValue.callSource)
    })

    it('follows screencast playback to the action running at that time', async () => {
      const panel = await mountPanel()

      // The playback position is inside setValue's span and inside no other's —
      // `activeSpanAt` is what the panel resolves it with, so the fixture's claim
      // about that time is asserted rather than assumed.
      expect(activeSpanAt(mergedOrder, SET_VALUE_PLAYBACK_TIME)).toBe(
        loginTimeline.setValue
      )

      window.dispatchEvent(
        new CustomEvent('app-screencast-progress', {
          detail: { time: SET_VALUE_PLAYBACK_TIME }
        })
      )
      await settle(panel)

      const active = shadowAll(panel, ACTIVE_ROW)
      expect(active).toHaveLength(1)
      expect(entryOf(active[0])).toEqual(loginTimeline.setValue)
    })
  })

  describe('tree mode', () => {
    const { groups } = loginActionTree

    it('renders the group tree instead of the merged list when groups are present', async () => {
      const panel = await mountPanel({ groups })

      expect(shadowAll(panel, GROUP_ROW)).toHaveLength(3)
      expect(shadowAll(panel, MUTATION_ROW)).toHaveLength(0)
    })

    it('starts a failed group expanded and a passing group collapsed', async () => {
      const panel = await mountPanel({ groups })

      const rows = shadowAll(panel, ROWS)
      expect(tagsOf(rows)).toEqual([
        GROUP_ROW,
        GROUP_ROW,
        COMMAND_ROW,
        COMMAND_ROW,
        GROUP_ROW
      ])
      expect((rows[0] as GroupRowElement).group).toEqual(
        loginActionTree.passingStep
      )
      expect(rows[0].hasAttribute('expanded')).toBe(false)
      expect((rows[1] as GroupRowElement).group).toEqual(
        loginActionTree.failedStep
      )
      expect(rows[1].hasAttribute('expanded')).toBe(true)
      // The nested group is a row of the expanded parent but stays closed itself.
      expect((rows[4] as GroupRowElement).group).toEqual(
        loginActionTree.nestedStep
      )
      expect(rows[4].hasAttribute('expanded')).toBe(false)
    })

    it('renders only the commands of expanded groups', async () => {
      const panel = await mountPanel({ groups })

      expect(shadowAll(panel, COMMAND_ROW).map(entryOf)).toEqual([
        loginTimeline.findInput,
        loginTimeline.setValue
      ])
    })

    it('times a tree row against the commands alone, not the merged list', async () => {
      const panel = await mountPanel({ groups })

      // Tree mode has no mutation rows, so its gaps and its baseline come from
      // the command stream — a row still handed the merged-list values would
      // report a duration its own group never contained.
      const commandDurations = durationsFor(commands)
      const commandElapsed = elapsedFor(commands)
      const rows = shadowAll(panel, COMMAND_ROW)

      expect(rows.map(durationOf)).toEqual([
        commandDurations[1],
        commandDurations[2]
      ])
      expect(rows.map(elapsedOf)).toEqual([
        commandElapsed[1],
        commandElapsed[2]
      ])
    })

    it("reveals a collapsed group's commands when the group row is clicked", async () => {
      const panel = await mountPanel({ groups })

      clickRow(shadowAll(panel, ROWS)[0])
      await settle(panel)

      const rows = shadowAll(panel, ROWS)
      expect(rows[0].hasAttribute('expanded')).toBe(true)
      expect(tagsOf(rows)).toEqual([
        GROUP_ROW,
        COMMAND_ROW,
        GROUP_ROW,
        COMMAND_ROW,
        COMMAND_ROW,
        GROUP_ROW
      ])
      expect(entryOf(rows[1])).toEqual(loginTimeline.url)
    })
  })
})
