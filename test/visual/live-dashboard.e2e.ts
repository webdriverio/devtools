// Layer B — live dashboard BEHAVIORAL e2e (no visual baselines). player.e2e.ts
// only ever runs the workbench in player mode; this boots it in LIVE mode
// (workbench.ts playerMode=false) and asserts the live wiring: it connects,
// renders the testrunner sidebar, and streams the synthetic event sequence into
// the panels. DOM/structural assertions (no screenshots) so it's deterministic
// across machines — unlike the pixel specs, this could run in CI.
//
// serveLive() boots the backend live and streams test/fixtures/live-synthetic.json
// over the worker WS; the app connects to /client via window.location.host and
// receives the buffered replay.

import { browser, $, $$, expect } from '@wdio/globals'

import { serveLive, type ServedLive } from '../support/serve-live.js'

// Top-level signals — single deep-combinator queries pierce all shadow roots.
const WORKBENCH = '>>> wdio-devtools-workbench'
const PLAYER_CONTROLS = '>>> wdio-devtools-trace-player-controls'
const ONBOARDING = '>>> wdio-devtools-start'
const SIDEBAR = '>>> wdio-devtools-sidebar'
// Single deep combinator only — WDIO mangles a chained `>>> a >>> b` into
// invalid CSS, so pierce straight to the row class (unique to each panel).
const COMMAND_ITEM = '>>> wdio-devtools-command-item'
const CONSOLE_ROW = '>>> .log-entry'
const NETWORK_ROW = '>>> .request-row'

async function openDockTab(label: string): Promise<void> {
  await browser.execute((l) => {
    window.dispatchEvent(
      new CustomEvent('open-dock-tab', { detail: { label: l } })
    )
  }, label)
}

describe('live dashboard (synthetic stream)', () => {
  let served: ServedLive

  before(async () => {
    served = await serveLive()
    await browser.url(served.url)
    await $(WORKBENCH).waitForExist({ timeout: 15000 })
  })

  after(async () => {
    await served?.close()
  })

  it('boots the workbench in live mode — connected, not player', async () => {
    await expect($(ONBOARDING)).not.toBeExisting() // past onboarding = WS connected
    await expect($(PLAYER_CONTROLS)).not.toBeExisting() // live, not trace-player
    await expect($(SIDEBAR)).toBeExisting() // testrunner live-only chrome
  })

  it('streams command rows into the actions panel', async () => {
    await browser.waitUntil(async () => (await $$(COMMAND_ITEM)).length >= 3, {
      timeout: 5000,
      timeoutMsg: 'expected 3 streamed command rows'
    })
  })

  it('streams console rows', async () => {
    await openDockTab('Console')
    await browser.waitUntil(async () => (await $$(CONSOLE_ROW)).length >= 2, {
      timeout: 5000,
      timeoutMsg: 'expected 2 streamed console rows'
    })
  })

  it('streams network rows', async () => {
    await openDockTab('Network')
    await browser.waitUntil(async () => (await $$(NETWORK_ROW)).length >= 2, {
      timeout: 5000,
      timeoutMsg: 'expected 2 streamed network rows'
    })
  })
})
