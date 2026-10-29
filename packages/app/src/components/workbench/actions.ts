import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { consume } from '@lit/context'

import type { CommandLog, TraceActionChild } from '@wdio/devtools-shared'
import {
  mutationContext,
  commandContext,
  actionGroupsContext
} from '../../controller/context.js'

import '../placeholder.js'
import './actionItems/command.js'
import './actionItems/group.js'
import './actionItems/mutation.js'
import type { RowRevealKey } from './actionItems/item.js'
import { elapsedSince } from '../../utils/elapsed.js'
import { entryDuration, stepDurations } from './actionItems/duration.js'
import { activeSpanAt } from './active-entry.js'
import {
  defaultCommandExpanded,
  defaultExpanded,
  flattenActionTree,
  nodeKey,
  rowKey,
  type ActionTreeRow,
  type RowToggleDetail
} from './action-tree.js'
import {
  defaultLiveExpanded,
  liveActionRows,
  liveRowKey,
  visibleMutations,
  type LiveRow,
  type TimelineEntry
} from './live-action-rows.js'

const SOURCE_COMPONENT = 'wdio-devtools-actions'

/** Horizontal shift per tree depth level in the player's action tree. */
const TREE_INDENT_PX = 14

@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        /* The panel's width is fixed by its drag handle; single-line rows must
           clip inside it rather than widen it (or scroll it) to fit. */
        min-width: 0;
        overflow-x: hidden;
      }

      /* Wraps the rows so the rail spans the full content height — the host
         itself is stretched to the viewport by the row-flex tab. */
      .timeline {
        position: relative;
        display: flex;
        flex-direction: column;
        padding: 8px 8px 12px;
      }

      /* Vertical rail threading the action icon chips. */
      .timeline::before {
        content: '';
        position: absolute;
        left: 28px;
        top: 18px;
        bottom: 18px;
        width: 1px;
        background: var(--vscode-panel-border);
        pointer-events: none;
      }

      /* Tree mode indents rows, so the straight rail no longer lines up. */
      .timeline.tree::before {
        display: none;
      }
    `
  ]

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  @consume({ context: actionGroupsContext, subscribe: true })
  groups?: TraceActionChild[]

  // The selected timeline row, tracked by object reference — timestamps aren't
  // unique (commands logged in the same millisecond would all match), so
  // reference identity is what highlights exactly one row.
  @state()
  private activeEntry?: TimelineEntry

  // User chevron toggles, by row key; an untouched group or a row that issued
  // others follows the default (failed or containing the active command → open).
  @state()
  private expandOverrides: ReadonlyMap<string, boolean> = new Map()

  // The one row showing its label in full. Held here, not per row, so clicking
  // a row folds whichever was open — otherwise every row the user ever clicked
  // stays wrapped and the panel goes ragged again.
  @state()
  private revealedRow?: RowRevealKey

  #onRowReveal = (event: Event) => {
    const key = (event as CustomEvent<RowRevealKey | undefined>).detail
    this.revealedRow = key === this.revealedRow ? undefined : key
  }

  #onGroupToggle = (event: Event) => {
    const { key, expanded } = (event as CustomEvent<RowToggleDetail>).detail
    const next = new Map(this.expandOverrides)
    next.set(key, !expanded)
    this.expandOverrides = next
  }

  #onShowCommand = (event: Event) => {
    const command = (event as CustomEvent<{ command?: CommandLog }>).detail
      ?.command
    this.activeEntry = command
    // Follow the call site in the Source editor passively — the Log tab is what
    // surfaces on a command click, so stealing focus to Source would flash.
    if (command?.callSource) {
      window.dispatchEvent(
        new CustomEvent('app-source-track', {
          detail: { callSource: command.callSource }
        })
      )
    }
  }

  #onSelectMutation = (event: Event) => {
    this.activeEntry = (event as CustomEvent<TraceMutation>).detail
  }

  // Screencast playback drives the highlight to the action at the current frame.
  // Only acts when the active action changes, so the editor isn't re-scrolled on
  // every timeupdate tick.
  #onScreencastProgress = (event: Event) => {
    const { time } = (event as CustomEvent<{ time: number }>).detail
    const active = activeSpanAt(this.#sortedEntries(), time)
    if (active === this.activeEntry) {
      return
    }
    this.activeEntry = active
    if (active && 'command' in active && active.callSource) {
      window.dispatchEvent(
        new CustomEvent('app-source-track', {
          detail: { callSource: active.callSource }
        })
      )
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', this.#onShowCommand)
    window.addEventListener('app-mutation-select', this.#onSelectMutation)
    window.addEventListener(
      'app-screencast-progress',
      this.#onScreencastProgress
    )
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('show-command', this.#onShowCommand)
    window.removeEventListener('app-mutation-select', this.#onSelectMutation)
    window.removeEventListener(
      'app-screencast-progress',
      this.#onScreencastProgress
    )
  }

  // Document loads + commands merged and ordered by time, nested rows included.
  #sortedEntries(): TimelineEntry[] {
    return [
      ...visibleMutations(this.mutations || []),
      ...(this.commands || [])
    ].sort((a, b) => a.timestamp - b.timestamp)
  }

  // Keep the action that's playing in view as the screencast scrubs.
  updated(changed: Map<string, unknown>): void {
    if (changed.has('activeEntry') && this.activeEntry !== undefined) {
      this.renderRoot
        .querySelector('[active]')
        ?.scrollIntoView({ block: 'nearest' })
    }
  }

  // Player tree mode: group rows expand/collapse; leaf rows are the same
  // command items as the flat list, indented under their group.
  #renderTree(rootChildren: TraceActionChild[]) {
    const commands = this.commands || []
    const activeIndex =
      this.activeEntry && 'command' in this.activeEntry
        ? commands.indexOf(this.activeEntry)
        : -1
    const active = activeIndex >= 0 ? activeIndex : undefined
    const isExpanded = (node: TraceActionChild) =>
      this.expandOverrides.get(nodeKey(node)) ??
      ('group' in node
        ? defaultExpanded(node.group, active)
        : defaultCommandExpanded(node, commands, active))
    const rows = flattenActionTree(rootChildren, isExpanded)
    const gaps = stepDurations(commands.map((command) => command.timestamp))
    return html`<div
      class="timeline tree"
      @group-toggle=${this.#onGroupToggle}
      @row-reveal=${this.#onRowReveal}
    >
      ${repeat(rows, rowKey, (row) => this.#renderTreeRow(row, commands, gaps))}
    </div>`
  }

  #renderTreeRow(
    row: ActionTreeRow,
    commands: CommandLog[],
    gaps: Array<number | undefined>
  ) {
    const indent = `padding-left: ${row.depth * TREE_INDENT_PX}px`
    const key = rowKey(row)
    if (row.kind === 'group') {
      return html`
        <wdio-devtools-group-item
          style=${indent}
          .group=${row.group}
          ?expanded=${row.expanded}
          .revealKey=${key}
          ?revealed=${key === this.revealedRow}
        ></wdio-devtools-group-item>
      `
    }
    const entry = commands[row.commandIndex]
    if (!entry) {
      return nothing
    }
    // Reconstructed zips carry the real invocation span; gap is the fallback.
    const duration = entryDuration(entry, gaps[row.commandIndex])
    return html`
      <wdio-devtools-command-item
        style=${indent}
        elapsedTime=${elapsedSince(commands, entry)}
        .duration=${duration}
        .entry=${entry}
        ?active=${entry === this.activeEntry}
        .revealKey=${key}
        ?revealed=${key === this.revealedRow}
        .toggleKey=${row.expanded === undefined ? undefined : key}
        ?expanded=${Boolean(row.expanded)}
      ></wdio-devtools-command-item>
    `
  }

  render() {
    if (this.groups?.length) {
      return this.#renderTree(this.groups)
    }
    const entries = this.#sortedEntries()

    if (!entries.length) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const rows = liveActionRows(
      this.mutations || [],
      this.commands || [],
      (node) =>
        this.expandOverrides.get(liveRowKey(node.command)) ??
        defaultLiveExpanded(node, this.activeEntry)
    )
    // Gaps between every entry in time order: tree order, or a collapsed row, would change a row's fallback duration.
    const gaps = stepDurations(entries.map((entry) => entry.timestamp))
    const gapOf = new Map(entries.map((entry, i) => [entry, gaps[i]]))
    // A nested row is indented, so the straight rail no longer lines up.
    const nested = rows.some((row) => row.key !== undefined)

    // Keyed by reference, the same identity `activeEntry` uses: timestamps
    // aren't unique, and an index would hand a row's local state to whatever
    // entry sorts into that position next.
    return html`<div
      class="timeline ${nested ? 'tree' : ''}"
      @group-toggle=${this.#onGroupToggle}
      @row-reveal=${this.#onRowReveal}
    >
      ${repeat(
        rows,
        (row) => row.entry,
        (row) => this.#renderLiveRow(row, entries, gapOf.get(row.entry))
      )}
    </div>`
  }

  #renderLiveRow(
    { entry, depth, expanded, key }: LiveRow,
    entries: TimelineEntry[],
    gap: number | undefined
  ) {
    // Timed against the merged list, so the top row always reads zero: a
    // document load can precede the first command.
    const elapsedTime = elapsedSince(entries, entry)
    const duration = entryDuration(entry, gap)
    const active = entry === this.activeEntry
    const revealed = entry === this.revealedRow
    const indent = depth ? `padding-left: ${depth * TREE_INDENT_PX}px` : ''

    if ('command' in entry) {
      return html`
        <wdio-devtools-command-item
          style=${indent}
          elapsedTime=${elapsedTime}
          .duration=${duration}
          .entry=${entry}
          ?active=${active}
          .revealKey=${entry}
          ?revealed=${revealed}
          .toggleKey=${key}
          ?expanded=${Boolean(expanded)}
        ></wdio-devtools-command-item>
      `
    }

    return html`
      <wdio-devtools-mutation-item
        elapsedTime=${elapsedTime}
        .duration=${duration}
        .entry=${entry}
        ?active=${active}
        .revealKey=${entry}
        ?revealed=${revealed}
      ></wdio-devtools-mutation-item>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsActions
  }
}
