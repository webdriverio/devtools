import { css, html, type TemplateResult } from 'lit'

import '~icons/mdi/check.js'
import '~icons/mdi/close.js'
import '~icons/mdi/debug-step-over.js'
import '~icons/mdi/circle-outline.js'
import '~icons/mdi/alert-circle-outline.js'

/** What a row's status icon can say; `unreadable` is a trace the player could not open. */
export type StateIconKind =
  'running' | 'passed' | 'failed' | 'skipped' | 'idle' | 'unreadable'

/** For any host that renders a `running` icon. */
export const STATE_ICON_STYLES = css`
  .run-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-charts-blue);
    animation: run-pulse 1.5s ease-in-out infinite;
  }
  @keyframes run-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.7);
    }
  }
`

const ICONS: Record<StateIconKind, TemplateResult> = {
  running: html`<span class="run-dot"></span>`,
  passed: html`<icon-mdi-check class="text-chartsGreen"></icon-mdi-check>`,
  failed: html`<icon-mdi-close class="text-chartsRed"></icon-mdi-close>`,
  skipped: html`<icon-mdi-debug-step-over
    class="text-chartsYellow"
  ></icon-mdi-debug-step-over>`,
  idle: html`<icon-mdi-circle-outline
    class="text-disabledForeground"
  ></icon-mdi-circle-outline>`,
  unreadable: html`<icon-mdi-alert-circle-outline
    class="text-chartsRed"
  ></icon-mdi-alert-circle-outline>`
}

/** Centred on the row's first line, so it lines up with the row's buttons. */
export function stateIcon(kind: StateIconKind): TemplateResult {
  return html`<span
    class="w-4 h-[18px] shrink-0 self-center grid place-items-center"
    >${ICONS[kind]}</span
  >`
}
