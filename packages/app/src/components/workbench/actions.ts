import { Element } from '@core/element'
import { html, css, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { SuiteStats, TestStats } from '@wdio/reporter'
import { suiteContext, commandContext, type CommandLog } from '../../controller/DataManager.js'

import '../placeholder.js'
import './actionItems/command.js'
import '../../components/sidebar/collapseableEntry.js'
import '~icons/mdi/play-box-outline.js'

type ActionItem = TestStats;

@customElement('wdio-devtools-actions')
export class DevtoolsActions extends Element {
  @consume({ context: suiteContext, subscribe: true })
  suites?: Record<string, SuiteStats>[] = []

  @consume({ context: commandContext, subscribe: true })
  commands?: CommandLog[] = []

  @state()
  private _expandedItemId: string | null = null

  private _getActionItems(suites: SuiteStats[]): ActionItem[] {
    let items: ActionItem[] = []
    for (const suite of suites) {
      items = items.concat(suite.tests)
      if (suite.suites) {
        items = items.concat(this._getActionItems(suite.suites))
      }
    }
    return items.sort((a, b) => {
        const startTimeA = a.start ? new Date(a.start).getTime() : 0;
        const startTimeB = b.start ? new Date(b.start).getTime() : 0;
        return startTimeA - startTimeB;
    });
  }

  // Renders a test step as a collapsible entry
  private _renderStep(step: TestStats): TemplateResult {
    if (!this.commands) return html``

    const stepCommands = this.commands.filter(cmd => {
        const startTime = step.start ? new Date(step.start).getTime() : 0;
        const endTime = step.end ? new Date(step.end).getTime() : Infinity;
        return cmd.timestamp >= startTime && cmd.timestamp <= endTime;
    });

    const startTime = step.start ? new Date(step.start).getTime() : 0;
    const endTime = step.end ? new Date(step.end).getTime() : 0;
    const duration = endTime > 0 ? endTime - startTime : 0;

    return html`
      <wdio-collapsable-entry
        .isInitiallyOpen=${this._expandedItemId === step.uid}
        @click=${() => this._expandedItemId = this._expandedItemId === step.uid ? null : step.uid}
      >
        <div slot="summary" class="step-summary">
          <icon-mdi-play-box-outline class="icon"></icon-mdi-play-box-outline>
          <span class="title">${step.title}</span>
          <span class="duration">${duration}ms</span>
        </div>
        <div class="commands">
          ${stepCommands.length > 0
            ? stepCommands.map(command => html`<wdio-devtools-command-item .entry=${command}></wdio-devtools-command-item>`)
            : html`<div class="no-commands">No commands recorded for this step.</div>`
          }
        </div>
      </wdio-collapsable-entry>
    `
  }

  render() {
    const allSuites = this.suites ? Object.values(this.suites).flatMap(s => Object.values(s)) : []
    const allItems = this._getActionItems(allSuites)

    // Remove duplicates based on uid
    // Assuming each TestStats has a unique 'uid' property
    const uniqueItems = Array.from(new Map(allItems.map(item => [item.uid, item])).values())

    if (uniqueItems.length === 0) {
      return html`<wdio-devtools-placeholder>No actions recorded.</wdio-devtools-placeholder>`
    }

    return html`
      <div class="action-list">
        ${uniqueItems.map(item => this._renderStep(item as TestStats))}
      </div>
    `
  }

  static styles = [...Element.styles, css`
    :host, .action-list {
      width: 100%;
      height: 100%;
    }

    .step-summary {
      display: flex;
      align-items: center;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--vscode-panel-border);
      gap: 0.5rem;
      font-size: 0.9em;
      cursor: pointer;
    }
    .step-summary:hover {
      background-color: var(--vscode-toolbar-hoverBackground);
    }
    .icon {
      width: 1.1rem;
      height: 1.1rem;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
    }
    .title {
      flex-grow: 1;
    }
    .duration {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .commands {
      padding-left: 2rem;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .no-commands {
      padding: 0.5rem 1.5rem;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  `]
}
