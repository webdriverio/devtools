// Layer B — trace-player visual regression. For each ready matrix entry we serve
// its committed golden fixture, load the player, and snapshot the whole player
// plus every panel we have a stable selector for. A missing fixture skips the
// block (fresh clone / CI before `pnpm fixtures:regen`), matching Layer A.
//
// The player is nested Lit shadow DOM with no data-testid, so panels are
// addressed by their custom-element tag through the `>>>` deep combinator.
// Dock panels (Console/Network/Errors/A11y) live inside inactive tabs; rather
// than click through nested shadow roots we fire the same `open-dock-tab`
// window event the app itself uses to switch tabs programmatically (tabs.ts).

import fs from 'node:fs'

import { browser, $, expect } from '@wdio/globals'

import { READY_ENTRIES } from '../capture/matrix.js'
import { fixtureTrace } from '../support/paths.js'
import { serveFixture, type ServedFixture } from '../support/serve-fixture.js'

const PLAYER_ROOT = 'wdio-devtools'
// Only exists in player mode — the reliable "player has mounted" signal.
const PLAYER_READY = '>>> wdio-devtools-trace-player-controls'

// Max % of pixels allowed to differ. A small tolerance absorbs sub-pixel
// anti-aliasing / font-hinting noise (and headed-vs-headless rendering); a real
// UI change is far larger. Prevents brittle 0%-threshold failures.
const MISMATCH_TOLERANCE = 0.1

interface Panel {
  name: string
  selector: string
  /** Dock-tab label to activate before snapshotting; omit for always-visible panels. */
  tab?: string
}

const PANELS: Panel[] = [
  { name: 'timeline', selector: '>>> wdio-devtools-trace-timeline' },
  { name: 'controls', selector: '>>> wdio-devtools-trace-player-controls' },
  { name: 'snapshot', selector: '>>> wdio-devtools-browser' },
  { name: 'actions', selector: '>>> wdio-devtools-actions' },
  {
    name: 'console',
    selector: '>>> wdio-devtools-console-logs',
    tab: 'Console'
  },
  { name: 'network', selector: '>>> wdio-devtools-network', tab: 'Network' },
  { name: 'errors', selector: '>>> wdio-devtools-errors', tab: 'Errors' },
  { name: 'a11y', selector: '>>> wdio-devtools-a11y', tab: 'A11y' }
]

async function activateDockTab(label: string): Promise<void> {
  await browser.execute((tab: string) => {
    window.dispatchEvent(
      new CustomEvent('open-dock-tab', { detail: { label: tab } })
    )
  }, label)
}

for (const entry of READY_ENTRIES) {
  const present = fs.existsSync(fixtureTrace(entry.id))
  const suite = present ? describe : describe.skip

  suite(entry.label, () => {
    let served: ServedFixture

    before(async () => {
      served = await serveFixture(entry.id)
      await browser.url(served.url)
      await $(PLAYER_ROOT).waitForExist({ timeout: 20000 })
      await $(PLAYER_READY).waitForExist({ timeout: 20000 })
    })

    after(async () => {
      await served?.close()
    })

    it('matches the full player', async () => {
      await expect(browser).toMatchScreenSnapshot(
        `player-${entry.id}`,
        MISMATCH_TOLERANCE
      )
    })

    for (const panel of PANELS) {
      it(`matches the ${panel.name} panel`, async () => {
        if (panel.tab) {
          await activateDockTab(panel.tab)
        }
        const el = await $(panel.selector)
        await el.waitForExist({ timeout: 10000 })
        await expect(el).toMatchElementSnapshot(
          `${entry.id}-${panel.name}`,
          MISMATCH_TOLERANCE
        )
      })
    }
  })
}
