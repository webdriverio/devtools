import { Element } from '@core/element'
import { html, nothing, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { EditorView, basicSetup } from 'codemirror'
import { Decoration, type DecorationSet } from '@codemirror/view'
import { StateField, StateEffect, type EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

import type { CommandLog } from '@wdio/devtools-shared'

import { sourceContext, commandContext } from '../../controller/context.js'
import { commandCategory, type ActionCategory } from './actionItems/category.js'
import { parseCallSource, fileBasename, pathSegments } from './call-source.js'
import { sourceStyles } from './source/styles.js'

import '../placeholder.js'

/** Category → theme token for the call-site accent (`--cs`). */
const CATEGORY_VAR: Record<ActionCategory, string> = {
  navigation: 'var(--vscode-charts-blue)',
  input: 'var(--vscode-charts-purple)',
  assertion: 'var(--vscode-charts-green)',
  query: 'var(--vscode-charts-yellow)',
  other: 'var(--vscode-descriptionForeground)'
}

/** Sets/clears the highlighted call-site line (1-based, or null to clear). */
const setCallSite = StateEffect.define<number | null>()

function lineDecoration(state: EditorState, line: number): DecorationSet {
  try {
    const info = state.doc.line(line)
    return Decoration.set([
      Decoration.line({ class: 'cm-callsite' }).range(info.from)
    ])
  } catch {
    return Decoration.none
  }
}

const callSiteField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setCallSite)) {
        next =
          effect.value === null
            ? Decoration.none
            : lineDecoration(tr.state, effect.value)
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

const SOURCE_COMPONENT = 'wdio-devtools-source'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  static styles = [...Element.styles, sourceStyles]

  @consume({ context: sourceContext, subscribe: true })
  @state()
  sources: Record<string, string> = {}

  @consume({ context: commandContext, subscribe: true })
  @state()
  commands: CommandLog[] = []

  @state() private activeFile?: string
  @state() private callSiteFile?: string
  @state() private callSiteLine?: number
  @state() private callSiteCommand?: string
  @state() private callSiteCategory: ActionCategory = 'other'

  #editorView?: EditorView
  #mountedFile?: string
  #editorIsDark = false
  #tabObserver?: MutationObserver
  #themeObserver?: MutationObserver

  #onHighlight = (ev: Event) =>
    this.#applyCallSource((ev as CustomEvent<string>).detail, true)
  #onTrack = (ev: Event) =>
    this.#applyCallSource(
      (ev as CustomEvent<{ callSource: string }>).detail.callSource,
      false
    )

  #isDark(): boolean {
    return document.body.classList.contains('dark')
  }

  /** File to show: an explicit selection/call-site, else the first available. */
  get #effectiveFile(): string | undefined {
    if (this.activeFile && this.sources?.[this.activeFile]) {
      return this.activeFile
    }
    return Object.keys(this.sources || {})[0]
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-source-highlight', this.#onHighlight)
    // Passive line-follow during screencast playback — scroll only, no tab flip.
    window.addEventListener('app-source-track', this.#onTrack)
    requestAnimationFrame(() => {
      const tab = this.closest('wdio-devtools-tab')
      if (tab) {
        this.#tabObserver = new MutationObserver(() => {
          if (tab.hasAttribute('active') && this.#editorView) {
            requestAnimationFrame(() => {
              this.#editorView?.requestMeasure()
              this.#editorView?.dom.dispatchEvent(new Event('resize'))
            })
          }
        })
        this.#tabObserver.observe(tab, {
          attributes: true,
          attributeFilter: ['active']
        })
      }
    })
    this.#themeObserver = new MutationObserver(() => {
      if (
        this.#editorView &&
        this.#mountedFile &&
        this.#editorIsDark !== this.#isDark()
      ) {
        this.#mountEditor(this.#mountedFile)
        this.#refreshCallSite()
      }
    })
    this.#themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    })
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('app-source-highlight', this.#onHighlight)
    window.removeEventListener('app-source-track', this.#onTrack)
    this.#editorView?.destroy()
    this.#editorView = undefined
    this.#tabObserver?.disconnect()
    this.#tabObserver = undefined
    this.#themeObserver?.disconnect()
    this.#themeObserver = undefined
  }

  updated(_changed: PropertyValues<this>) {
    const target = this.#effectiveFile
    if (!target) {
      return
    }
    this.#mountEditor(target)
    this.#refreshCallSite()
  }

  #applyCallSource(callSource: string, activateTab: boolean) {
    const parsed = parseCallSource(callSource)
    if (!parsed) {
      return
    }
    this.activeFile = parsed.file
    this.callSiteFile = parsed.file
    this.callSiteLine = parsed.line
    const cmd = this.#commandAt(parsed.file, parsed.line)
    this.callSiteCommand = cmd?.command
    this.callSiteCategory = cmd ? commandCategory(cmd.command) : 'other'
    if (activateTab) {
      this.closest('wdio-devtools-tabs')?.activateTab('Source')
    }
  }

  #commandAt(file: string, line: number): CommandLog | undefined {
    return this.commands?.find((c) => {
      if (!c.callSource) {
        return false
      }
      const parsed = parseCallSource(c.callSource)
      return parsed?.file === file && parsed.line === line
    })
  }

  #selectFile(file: string) {
    this.activeFile = file
  }

  #mountEditor(filePath: string) {
    const source = this.sources?.[filePath]
    if (!source) {
      return
    }
    const container =
      this.shadowRoot?.querySelector<HTMLElement>('.source-container')
    if (!container) {
      return
    }
    // Reuse the editor when file + theme are unchanged.
    if (
      this.#editorView &&
      this.#mountedFile === filePath &&
      this.#editorIsDark === this.#isDark()
    ) {
      return
    }

    this.#editorView?.destroy()
    const dark = this.#isDark()
    this.#editorView = new EditorView({
      root: this.shadowRoot!,
      extensions: [
        basicSetup,
        javascript(),
        callSiteField,
        ...(dark ? [oneDark] : [])
      ],
      doc: source,
      parent: container
    })
    this.#editorIsDark = dark
    this.#mountedFile = filePath
    requestAnimationFrame(() => this.#editorView?.requestMeasure())
  }

  /** Apply (or clear) the call-site decoration + scroll for the mounted file. */
  #refreshCallSite() {
    const view = this.#editorView
    if (!view) {
      return
    }
    const onThisFile =
      !!this.callSiteFile && this.callSiteFile === this.#mountedFile
    const line = onThisFile ? this.callSiteLine : undefined
    this.style.setProperty(
      '--cs',
      onThisFile ? CATEGORY_VAR[this.callSiteCategory] : CATEGORY_VAR.other
    )

    const effects: StateEffect<unknown>[] = [setCallSite.of(line ?? null)]
    if (line && line > 0) {
      try {
        const info = view.state.doc.line(line)
        effects.push(EditorView.scrollIntoView(info.from, { y: 'center' }))
      } catch {
        /* out-of-range line — leave decoration cleared */
      }
    }
    view.dispatch({ effects })
  }

  #renderFileTabs(active: string) {
    return Object.keys(this.sources || {}).map(
      (file) =>
        html`<button
          class="src-file ${file === active ? 'active' : ''}"
          title=${file}
          @click=${() => this.#selectFile(file)}
        >
          ${fileBasename(file)}
        </button>`
    )
  }

  #renderToolbar(active: string) {
    const segments = pathSegments(active)
    // Show only the tail of the path; the full path stays in the hover title
    // and is what "Copy path" copies.
    const shown = segments.slice(-3)
    const truncated = segments.length > shown.length
    const dirSegments = shown.slice(0, -1)
    const base = shown[shown.length - 1] || active
    const showChip =
      this.callSiteFile === active && this.callSiteCommand && this.callSiteLine

    return html`<div class="src-toolbar">
      <div class="src-files">${this.#renderFileTabs(active)}</div>
      <div class="src-meta">
        <div class="src-path" title=${active}>
          ${truncated
            ? html`<span class="sep">…/</span>`
            : nothing}${dirSegments.map(
            (seg) => html`<span>${seg}</span><span class="sep">/</span>`
          )}<span class="base">${base}</span>
        </div>
        ${showChip
          ? html`<button
              class="cs-chip"
              title="Jump to the line that triggered this command"
              @click=${() => this.#refreshCallSite()}
            >
              <span class="dot"></span
              ><span class="cmd">${this.callSiteCommand}</span
              ><span class="ln">L${this.callSiteLine}</span>
            </button>`
          : nothing}
        <div class="src-actions">
          <button class="src-act" @click=${() => this.#copyPath(active)}>
            Copy path
          </button>
          <a
            class="src-act"
            href=${this.#editorLink(active)}
            title="Open in editor"
            >Open in editor</a
          >
        </div>
      </div>
    </div>`
  }

  #copyPath(file: string) {
    navigator.clipboard?.writeText(file).catch(() => {
      /* clipboard unavailable — non-fatal */
    })
  }

  #editorLink(file: string): string {
    const onThisFile = this.callSiteFile === file && this.callSiteLine
    return `vscode://file/${file}${onThisFile ? `:${this.callSiteLine}` : ''}`
  }

  render() {
    const active = this.#effectiveFile
    if (!active) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    return html`<div class="source-root">
      ${this.#renderToolbar(active)}
      <div class="source-container"></div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
