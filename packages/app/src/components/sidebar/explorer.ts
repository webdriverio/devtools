import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/eye.js'
import '~icons/mdi/collapse-all.js'

import './test-suite.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'

@customElement(EXPLORER)
export class DevtoolsSidebarExplorer extends Element {
  static styles = [...Element.styles, css`
    :host {
      width: 100%;
      display: block;
    }
  `]

  render() {
    return html`
      <header class="pl-4 py-2 flex shadow-md pr-2">
        <h3 class="flex content-center flex-wrap uppercase font-bold text-sm">Tests</h3>
        <nav class="flex ml-auto">
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-play class="group-hover:text-chartsGreen"></icon-mdi-play></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-stop class="group-hover:text-chartsRed"></icon-mdi-stop></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-eye class="group-hover:text-chartsYellow"></icon-mdi-eye></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-collapse-all class="group-hover:text-chartsBlue"></icon-mdi-collapse-all></button>
        </nav>
      </header>
      <wdio-test-suite>
        <wdio-test-entry state="failed">
          <label slot="label">example.e2e.ts</label>
        </wdio-test-entry>
        <wdio-test-entry>
          <label slot="label">example.e2e.ts</label>
          <wdio-test-suite slot="children">
            <wdio-test-entry>
              <label slot="label">should have done this</label>
              <wdio-test-suite slot="children">
                <wdio-test-entry>
                  <label slot="label">should have done this</label>
                  <wdio-test-suite slot="children">
                    <wdio-test-entry>
                      <label slot="label">should have done this</label>
                      <wdio-test-suite slot="children">
                        <wdio-test-entry>
                          <label slot="label">should have done this</label>
                            <wdio-test-suite slot="children">
                              <wdio-test-entry>
                                <label slot="label">should have done this</label>
                                  <wdio-test-suite slot="children">
                                    <wdio-test-entry>
                                      <label slot="label">should have done this</label>
                                    </wdio-test-entry>
                                  </wdio-test-suite>
                              </wdio-test-entry>
                            </wdio-test-suite>
                        </wdio-test-entry>
                      </wdio-test-suite>
                    </wdio-test-entry>
                  </wdio-test-suite>
                </wdio-test-entry>
              </wdio-test-suite>
            </wdio-test-entry>
            <wdio-test-entry>
              <label slot="label">should have done this</label>
            </wdio-test-entry>
            <wdio-test-entry>
              <label slot="label">should have done this</label>
            </wdio-test-entry>
            <wdio-test-entry>
              <label slot="label">should have done this</label>
            </wdio-test-entry>
            <wdio-test-entry>
              <label slot="label">should have done this</label>
            </wdio-test-entry>
          </wdio-test-suite>
        </wdio-test-entry>
        <wdio-test-entry state="passed">
          <label slot="label">example.e2e.ts</label>
        </wdio-test-entry>
        <wdio-test-entry state="failed">
          <label slot="label">example.e2e.ts</label>
        </wdio-test-entry>
        <wdio-test-entry state="skipped">
          <label slot="label">example.e2e.ts</label>
        </wdio-test-entry>
        <wdio-test-entry state="running">
          <label slot="label">example.e2e.ts</label>
        </wdio-test-entry>
      </wdio-test-suite>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [EXPLORER]: DevtoolsSidebarExplorer
  }
}
