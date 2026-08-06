import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'

import {
  isSnapshotHeaderLine,
  SNAPSHOT_INDENT_UNIT,
  SNAPSHOT_LOCATOR_DELIM
} from '@wdio/devtools-shared'
import type { CommandLog } from '@wdio/devtools-shared'

import '../placeholder.js'

const COMPONENT = 'wdio-devtools-a11y'
const NAME_MAX = 64
const UNAVAILABLE_GLYPH = '🌳'

interface A11yNode {
  depth: number
  role: string
  name: string
  /** Captured locator (from the serialized `→ …` suffix), when the node is an
   *  element — hovering highlights it in the snapshot; clicking copies it. */
  selector?: string
}

/** Player dock tab: the accessibility tree (roles + accessible names) captured
 *  for the selected command — the semantic view a screen reader sees, distinct
 *  from the raw DOM the snapshot pane replays. Follows the active command via
 *  the same `show-command` event the browser pane listens to. */
@customElement(COMPONENT)
export class DevtoolsA11yTree extends Element {
  @state()
  private active?: CommandLog

  /** Locator just copied — the row shows a brief "copied" flash. */
  @state()
  private copiedSel?: string

  /** Locator under the cursor — drives the copy-hint bar so the click-to-copy
   *  affordance is discoverable without waiting for the native title tooltip. */
  @state()
  private hoveredSel?: string

  /** Reverse of #highlight — the row the snapshot pane points at. `revealed` is
   *  transient (overlay-box hover); `pinned` persists (box click, which also
   *  opens this tab). Both matched by selector then accessible name. */
  @state()
  private revealed?: { selector?: string; label?: string }

  @state()
  private pinned?: { selector?: string; label?: string }

  #onShow = (e: Event) => {
    this.active = (e as CustomEvent<{ command?: CommandLog }>).detail?.command
    // A pin belongs to one page state; drop it when the command changes.
    this.pinned = undefined
    this.revealed = undefined
    this.hoveredSel = undefined
  }

  #onReveal = (e: Event) => {
    const detail = (
      e as CustomEvent<{
        selector?: string
        label?: string
        pin?: boolean
      } | null>
    ).detail
    if (detail?.pin) {
      this.pinned = { selector: detail.selector, label: detail.label }
    } else {
      this.revealed = detail ?? undefined
    }
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('show-command', this.#onShow as EventListener)
    window.addEventListener('a11y-reveal', this.#onReveal as EventListener)
  }
  disconnectedCallback() {
    window.removeEventListener('show-command', this.#onShow as EventListener)
    window.removeEventListener('a11y-reveal', this.#onReveal as EventListener)
    this.#highlight(undefined)
    super.disconnectedCallback()
  }

  /** Scroll the highlighted row into view when the snapshot pane points at it. */
  updated() {
    if (this.revealed || this.pinned) {
      this.renderRoot
        ?.querySelector('.node.hot')
        ?.scrollIntoView({ block: 'nearest' })
    }
  }

  /** A node matches a reveal target by exact selector, else by accessible name
   *  (covers locators the serializer captured differently, e.g. the test's
   *  `button[type=submit]` vs `button*=Login`). */
  #matches(node: A11yNode, target?: { selector?: string; label?: string }) {
    if (!target) {
      return false
    }
    if (
      target.selector &&
      node.selector &&
      node.selector.trim() === target.selector.trim()
    ) {
      return true
    }
    return !!(
      target.label &&
      node.name &&
      node.name.trim() === target.label.trim()
    )
  }

  #isRevealed(node: A11yNode): boolean {
    return (
      this.#matches(node, this.revealed) || this.#matches(node, this.pinned)
    )
  }

  /** Ask the snapshot pane to outline (or clear) the element for this locator. */
  #highlight(selector?: string) {
    window.dispatchEvent(
      new CustomEvent('a11y-highlight', {
        detail: selector ? { selector } : null
      })
    )
  }

  async #copy(selector?: string) {
    if (!selector) {
      return
    }
    try {
      await navigator.clipboard.writeText(selector)
      this.copiedSel = selector
      setTimeout(() => {
        this.copiedSel = undefined
      }, 1200)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      /* Fixed hint bar: names the click-to-copy affordance and echoes the
         locator under the cursor, so it's discoverable without the native
         title tooltip. Stays put while the tree scrolls beneath it. */
      .copybar {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 11px;
        border-bottom: 1px solid
          var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
        background: var(
          --vscode-editorWidget-background,
          rgba(255, 255, 255, 0.03)
        );
        white-space: nowrap;
        overflow: hidden;
      }
      .copybar .clip {
        color: var(--pick, #38bdf8);
        flex: none;
      }
      .copybar .lead {
        color: var(--vscode-descriptionForeground);
        flex: none;
      }
      .copybar .loc {
        color: var(--pick, #38bdf8);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .copybar .ok {
        color: var(--vscode-charts-green, #46c96a);
        flex: none;
      }
      .copybar .idle {
        color: var(--vscode-descriptionForeground);
        opacity: 0.7;
      }
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .tree {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        padding: 10px 12px;
      }
      .hdr {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin: 0 0 8px 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .node {
        display: flex;
        align-items: baseline;
        gap: 7px;
        padding: 2px 6px;
        border-radius: 6px;
        line-height: 1.35;
        white-space: nowrap;
      }
      .node:hover {
        background: var(
          --vscode-list-hoverBackground,
          rgba(255, 255, 255, 0.05)
        );
      }
      .twig {
        color: var(--vscode-descriptionForeground);
        opacity: 0.5;
        flex: none;
      }
      .role {
        color: var(--accent, #ff6a3d);
        flex: none;
      }
      .nm {
        color: var(--vscode-charts-green, #46c96a);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .node.pick {
        cursor: pointer;
      }
      .sel {
        margin-left: auto;
        padding-left: 12px;
        color: var(--pick, #38bdf8);
        opacity: 0;
        font-size: 11px;
        flex: none;
      }
      .node.pick:hover .sel {
        opacity: 0.85;
      }
      .node.hot {
        background: color-mix(in srgb, var(--pick, #38bdf8) 22%, transparent);
        box-shadow: inset 0 0 0 1px var(--pick, #38bdf8);
      }
      .node.hot .sel {
        opacity: 0.85;
      }
    `
  ]

  #trunc(name: string): string {
    return name.length > NAME_MAX ? name.slice(0, NAME_MAX - 1) + '…' : name
  }

  /** Parse one serialized line — `<indent>role[level] "name" [∈ …] [→ …]` — into
   *  a node, dropping the purpose/selector suffixes for a clean tree. Header and
   *  blank lines return null. */
  #parse(line: string): A11yNode | null {
    const trimmed = line.trimStart()
    if (!trimmed || isSnapshotHeaderLine(trimmed)) {
      return null
    }
    const indent = line.length - trimmed.length
    const depth = Math.max(
      0,
      Math.floor(indent / SNAPSHOT_INDENT_UNIT.length) - 1
    )
    const role = /^\S+/.exec(trimmed)?.[0] ?? trimmed
    const name = /"([^"]*)"/.exec(trimmed)?.[1] ?? ''
    // The `→ <locator>` suffix (last one wins; skips any `∈ "purpose"` before it).
    const selector = trimmed.includes(SNAPSHOT_LOCATOR_DELIM)
      ? trimmed.split(SNAPSHOT_LOCATOR_DELIM).pop()?.trim() || undefined
      : undefined
    return { depth, role, name, selector }
  }

  #row(node: A11yNode): TemplateResult {
    const sel = node.selector
    const hot = this.#isRevealed(node)
    return html`<div
      class="node ${sel ? 'pick' : ''} ${hot ? 'hot' : ''}"
      style="padding-left:${8 + node.depth * 16}px"
      @mouseenter=${() => {
        this.hoveredSel = sel
        this.#highlight(sel)
      }}
      @mouseleave=${() => {
        this.hoveredSel = undefined
        this.#highlight(undefined)
      }}
      @click=${() => this.#copy(sel)}
      title=${sel ? `Click to copy locator: ${sel}` : nothing}
    >
      <span class="twig">•</span>
      <span class="role">${node.role}</span>
      ${node.name
        ? html`<span class="nm">"${this.#trunc(node.name)}"</span>`
        : nothing}
      ${sel
        ? html`<span class="sel"
            >${this.copiedSel === sel ? 'copied ✓' : sel}</span
          >`
        : nothing}
    </div>`
  }

  /** The copy-hint bar's content: a copied confirmation, else the locator under
   *  the cursor (or the one the snapshot pane is pointing at), else the idle
   *  affordance prompt. */
  #hint(): TemplateResult {
    if (this.copiedSel) {
      return html`<span class="ok">✓ Copied</span
        ><span class="loc">${this.copiedSel}</span>`
    }
    const sel =
      this.hoveredSel ?? this.pinned?.selector ?? this.revealed?.selector
    if (sel) {
      return html`<span class="clip">⧉</span
        ><span class="lead">Click to copy locator:</span
        ><span class="loc">${sel}</span>`
    }
    return html`<span class="clip">⧉</span
      ><span class="idle"
        >Hover a node to preview its locator — click to copy</span
      >`
  }

  /** Why the panel is empty. A selected command with no `snapshotText` is a
   *  capture gap, not an idle panel — all three adapters capture the tree, so
   *  what lands here is a command whose capture never bound to it. */
  #unavailable(): TemplateResult {
    return this.active
      ? html`<wdio-devtools-placeholder
          icon="${UNAVAILABLE_GLYPH}"
          heading="No accessibility snapshot for this command"
          description="Nothing was captured for this action — either the capture had not resolved when the trace slice was written, or the action ran on native mobile, which has no DOM tree."
        ></wdio-devtools-placeholder>`
      : html`<wdio-devtools-placeholder
          icon="${UNAVAILABLE_GLYPH}"
          heading="No command selected"
          description="Select a command in the Actions tab to see the accessibility tree captured for it."
        ></wdio-devtools-placeholder>`
  }

  render() {
    const text = this.active?.snapshotText
    if (!text) {
      return this.#unavailable()
    }
    const lines = text.split('\n')
    // Web captures head `[Page: <title> — <url>]`, native ones `[<platform> …]`.
    const header =
      lines[0] && isSnapshotHeaderLine(lines[0]) ? lines[0] : undefined
    const nodes = lines
      .map((l) => this.#parse(l))
      .filter((n): n is A11yNode => n !== null)
    return html`<div class="copybar">${this.#hint()}</div>
      <div class="scroll">
        <div class="tree">
          ${header ? html`<div class="hdr">${header}</div>` : nothing}
          ${nodes.map((n) => this.#row(n))}
        </div>
      </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsA11yTree
  }
}
