import type { nothing } from 'lit'
import { html, type TemplateResult } from 'lit'

import '~icons/mdi/world.js'
import '~icons/mdi/lock.js'

/** The browser-frame chrome: traffic-light dots, address bar (with a lock for
 *  https), and a slot for the Snapshot/Screencast view toggle. Extracted from
 *  the snapshot component so that file stays focused on capture/replay. */
export function renderBrowserChrome(
  displayUrl: string | undefined,
  viewToggle: TemplateResult | typeof nothing
): TemplateResult {
  return html`
    <header
      class="flex items-center mx-2 bg-sideBarBackground rounded-t-[14px]"
    >
      <div class="frame-dot bg-notificationsErrorIconForeground"></div>
      <div class="frame-dot bg-notificationsWarningIconForeground"></div>
      <div class="frame-dot bg-portsIconRunningProcessForeground"></div>
      <div
        class="flex items-center mx-4 my-2 pr-2 bg-input-background text-inputForeground border border-editorSuggestWidgetBorder rounded leading-7 flex-1 min-w-0 overflow-hidden"
      >
        ${displayUrl?.startsWith('https')
          ? html`<icon-mdi-lock
              class="w-[16px] h-[16px] m-1 mr-2 flex-shrink-0 text-chartsGreen"
            ></icon-mdi-lock>`
          : html`<icon-mdi-world
              class="w-[20px] h-[20px] m-1 mr-2 flex-shrink-0"
            ></icon-mdi-world>`}
        <span class="truncate">${displayUrl}</span>
      </div>
      ${viewToggle}
    </header>
  `
}
