import {
  actionGroupsContext,
  commandContext,
  mutationContext
} from '@/controller/context.js'
import '@components/workbench/actions.js'

import { mountWithContext, settle } from '../../support/mount.js'
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

const { commands, mutations } = loginTimeline

const tagsOf = (rows: Element[]) => rows.map((row) => row.tagName.toLowerCase())

const entryOf = (row: Element) =>
  (row as CommandRowElement | MutationRowElement).entry

const clickRow = (row: Element) => shadow(row, 'button')?.click()

describe('wdio-devtools-actions', () => {
  describe('merged timeline', () => {
    it('orders commands and document loads into a single list by timestamp', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      expect(shadowAll(panel, ROWS).map(entryOf)).toEqual([
        loginTimeline.url,
        loginTimeline.documentLoad,
        loginTimeline.findInput,
        loginTimeline.setValue,
        loginTimeline.click
      ])
    })

    it('renders a command row per command and a mutation row per document load', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      expect(tagsOf(shadowAll(panel, ROWS))).toEqual([
        COMMAND_ROW,
        MUTATION_ROW,
        COMMAND_ROW,
        COMMAND_ROW,
        COMMAND_ROW
      ])
    })

    it('leaves out mutations that are not document loads', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      const mutationRows = shadowAll(panel, MUTATION_ROW)
      expect(mutationRows).toHaveLength(1)
      expect(entryOf(mutationRows[0])).toEqual(loginTimeline.documentLoad)
    })

    it('measures elapsed time from the first entry of the merged list', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      const elapsed = shadowAll(panel, ROWS).map(
        (row) => (row as CommandRowElement | MutationRowElement).elapsedTime
      )
      expect(elapsed).toEqual([0, 30, 220, 360, 880])
    })

    it('renders the placeholder while no commands or mutations have arrived', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: [] },
        { context: mutationContext, value: [] }
      ])
      await settle(panel)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, ROWS)).toHaveLength(0)
    })
  })

  describe('row duration', () => {
    it("prefers a command's own execution span over the gap to the next entry", async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      const rows = shadowAll(panel, ROWS)
      // url spans 420ms but is followed by a 30ms gap; setValue spans 80ms and is
      // followed by a 520ms gap.
      expect((rows[0] as CommandRowElement).duration).toBe(420)
      expect((rows[3] as CommandRowElement).duration).toBe(80)
    })

    it('falls back to the gap between entries for rows without a span', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      const rows = shadowAll(panel, ROWS)
      expect((rows[1] as MutationRowElement).duration).toBe(190)
      // The last row has no next entry, so it borrows the preceding gap.
      expect((rows[4] as CommandRowElement).duration).toBe(520)
    })
  })

  describe('active row', () => {
    it('marks the clicked command as the only active row', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      clickRow(shadowAll(panel, ROWS)[3])
      await settle(panel)

      const active = shadowAll(panel, ACTIVE_ROW)
      expect(active).toHaveLength(1)
      expect(entryOf(active[0])).toEqual(loginTimeline.setValue)
    })

    it('marks the clicked document load as the active row', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

      clickRow(shadowAll(panel, ROWS)[1])
      await settle(panel)

      const active = shadowAll(panel, ACTIVE_ROW)
      expect(active).toHaveLength(1)
      expect(tagsOf(active)).toEqual([MUTATION_ROW])
      expect(entryOf(active[0])).toEqual(loginTimeline.documentLoad)
    })

    it("announces the clicked command's call source for the source editor", async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

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
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations }
      ])
      await settle(panel)

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
    it('renders the group tree instead of the merged list when groups are present', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations },
        { context: actionGroupsContext, value: loginActionTree.groups }
      ])
      await settle(panel)

      expect(shadowAll(panel, GROUP_ROW)).toHaveLength(3)
      expect(shadowAll(panel, MUTATION_ROW)).toHaveLength(0)
    })

    it('starts a failed group expanded and a passing group collapsed', async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations },
        { context: actionGroupsContext, value: loginActionTree.groups }
      ])
      await settle(panel)

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
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations },
        { context: actionGroupsContext, value: loginActionTree.groups }
      ])
      await settle(panel)

      expect(shadowAll(panel, COMMAND_ROW).map(entryOf)).toEqual([
        loginTimeline.findInput,
        loginTimeline.setValue
      ])
    })

    it("reveals a collapsed group's commands when the group row is clicked", async () => {
      const panel = await mountWithContext(PANEL, [
        { context: commandContext, value: commands },
        { context: mutationContext, value: mutations },
        { context: actionGroupsContext, value: loginActionTree.groups }
      ])
      await settle(panel)

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
