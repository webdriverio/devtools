import type {
  CommandLog,
  Metadata,
  MetadataBySession
} from '@wdio/devtools-shared'

import {
  commandContext,
  metadataBySessionContext,
  metadataContext,
  mutationContext
} from '@/controller/context.js'
import { mutationForCommand } from '@components/browser/mutation-at-command.js'
import '@components/browser/snapshot.js'

import { mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  CANCEL_ARIA_LABEL,
  CANCEL_TEXT,
  FLASH_TEXT,
  LOGIN_LABEL,
  NOTICE_LEAD,
  NOTICE_TAIL,
  NOTICE_TAIL_UPDATED,
  NOTICE_WHO,
  REF,
  STALE_USERNAME,
  TYPED_USERNAME,
  UNNAMED_LABEL,
  USERNAME_PLACEHOLDER
} from './captured-pages.js'
import {
  CAPTURED_VIEWPORT,
  domlessTrace,
  LOGIN_SHOT,
  LOGIN_URL,
  loginTrace,
  looseTextTrace,
  METADATA_URL,
  metadataForViewport,
  orphanTrace,
  overlayLabelTrace,
  preCaptureTrace,
  RECORDING,
  recordedSessionMetadata,
  SECURE_SHOT,
  SECURE_URL,
  textNodeTrace,
  type TextTrace,
  type TraceScenario,
  urllessTrace,
  urlMetadata,
  validationTrace,
  VIDEO_SESSION_ID,
  viewportlessMetadata,
  viewportMetadata
} from './fixtures.js'

const TAG = 'wdio-devtools-browser'
const ADDRESS_BAR = 'header .truncate'
const SCREENSHOT = '.screenshot-overlay img'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const SCREENCAST = 'wdio-devtools-screencast-player'
const VIEW_BUTTON = '.view-toggle button'
/** One option per recording the player holds — rendered from the second on. */
const RECORDING_OPTION = '.video-select option'
const OVERLAY_TOGGLE = 'button[title^="Element overlay"]'
/** Boxes `element-overlay` draws inside the replayed page. */
const OVERLAY_BOX = '.__wdio-el-overlay__'
/** Single outline the player draws for a hovered mutation or a11y row. */
const HIGHLIGHT_BOX = '.__mutation-highlight__'

type Browser = HTMLElementTagNameMap[typeof TAG]

interface Inputs {
  commands?: CommandLog[]
  mutations?: TraceMutation[]
  metadata?: Metadata
  metadataBySession?: MetadataBySession
}

function mountBrowser(inputs: Inputs = {}): Promise<Browser> {
  return mountWithContext<Browser>(TAG, [
    { context: commandContext, value: inputs.commands ?? [] },
    { context: mutationContext, value: inputs.mutations ?? [] },
    { context: metadataContext, value: inputs.metadata ?? viewportMetadata },
    { context: metadataBySessionContext, value: inputs.metadataBySession ?? {} }
  ])
}

const replayDoc = (el: Browser): Document | null =>
  el.iframe?.contentDocument ?? null

/** rAF-paced poll. A replay resolves across several microtasks plus a frame, so
 *  awaiting one render cannot observe its result. */
async function waitFor<T>(
  probe: () => T | null | undefined,
  what: string
): Promise<T> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const value = probe()
    if (value) {
      return value
    }
    await new Promise<number>((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** The replayed document, once the mount's own first rebuild has landed. */
function replayedPage(el: Browser): Promise<Document> {
  return waitFor(() => {
    const doc = replayDoc(el)
    return doc?.body?.firstElementChild ? doc : null
  }, 'the initial DOM replay')
}

/** Runs `act`, then resolves with the rebuilt document. Every replay re-renders
 *  from the document anchor it resolves to, so a fresh `documentElement` is the
 *  signal that the selection's anchor has been applied — the mutations that
 *  follow it in the window land later, which is what `waitUntil` is for. */
async function replayAfter(el: Browser, act: () => void): Promise<Document> {
  const previous = replayDoc(el)?.documentElement
  act()
  return waitFor(() => {
    const doc = replayDoc(el)
    return doc && doc.documentElement !== previous ? doc : null
  }, 'the replayed document to be rebuilt')
}

/**
 * rAF-paced poll for a condition — state a truthy probe cannot express
 * (`value === ''`). The first check is deferred by one frame deliberately: a
 * replay walks the mutations after its anchor across microtasks, so a
 * synchronous read lands on a half-applied page. One frame is enough because
 * that walk never yields to the task queue.
 */
async function waitUntil(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await new Promise<number>((resolve) => requestAnimationFrame(resolve))
    if (cond()) {
      return
    }
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const selectCommand = (command: CommandLog) =>
  window.dispatchEvent(new CustomEvent('show-command', { detail: { command } }))

const selectMutation = (entry: TraceMutation) =>
  window.dispatchEvent(
    new CustomEvent('app-mutation-select', { detail: entry })
  )

const hoverMutation = (entry: TraceMutation | null) =>
  window.dispatchEvent(
    new CustomEvent('app-mutation-highlight', { detail: entry })
  )

const revealFromA11y = (selector: string) =>
  window.dispatchEvent(
    new CustomEvent('a11y-highlight', { detail: { selector } })
  )

const recordingArrives = () =>
  window.dispatchEvent(
    new CustomEvent('screencast-ready', {
      detail: { sessionId: VIDEO_SESSION_ID, ...RECORDING }
    })
  )

function input(doc: Document, selector: string): HTMLInputElement {
  const el = doc.querySelector<HTMLInputElement>(selector)
  if (!el) {
    throw new Error(`No ${selector} in the replayed page`)
  }
  return el
}

const boxesIn = (el: Browser, selector: string) =>
  Array.from(replayDoc(el)?.querySelectorAll<HTMLElement>(selector) ?? [])

describe('wdio-devtools-browser', () => {
  describe('document replay', () => {
    it('rebuilds the iframe document from the captured document anchor', async () => {
      const el = await mountBrowser(loginTrace)
      const doc = await replayedPage(el)

      expect(doc.querySelector('form#login')).toBeTruthy()
      expect(doc.querySelectorAll('input')).toHaveLength(5)
      expect(doc.querySelector('button#submit')).toBeTruthy()
      expect(doc.body.getAttribute('data-wdio-ref')).toBe(REF.body)
    })

    it('never replays the captured page scripts', async () => {
      const el = await mountBrowser(loginTrace)
      const doc = await replayedPage(el)

      expect(doc.querySelectorAll('script')).toHaveLength(0)
    })

    it('resolves the replayed page against the captured page URL', async () => {
      const el = await mountBrowser(loginTrace)
      const doc = await replayedPage(el)

      expect(doc.querySelector('base')?.getAttribute('href')).toBe(LOGIN_URL)
    })

    it('shows the captured page URL in the address bar', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      await settle(el)

      expect(text(shadow(el, ADDRESS_BAR))).toBe(LOGIN_URL)
    })

    it('shows the DOM of the first capture before any command is selected', async () => {
      const el = await mountBrowser(loginTrace)
      const doc = await replayedPage(el)

      // The later anchor is the secure page, so this proves it is not replaying
      // the newest capture it has.
      expect(doc.querySelector('#flash')).toBeNull()
      expect(input(doc, '#username').value).toBe(STALE_USERNAME)
    })
  })

  describe('form state', () => {
    it('replays the text the test typed into the input', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectCommand(loginTrace.typeUsername)
      )
      await waitUntil(
        () => input(doc, '#username').value === TYPED_USERNAME,
        'the typed value to replay'
      )

      const username = input(doc, '#username')
      expect(username.value).toBe(TYPED_USERNAME)
      expect(username.getAttribute('value')).toBe(TYPED_USERNAME)
    })

    it('replays a field cleared back to empty', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectMutation(loginTrace.usernameCleared)
      )
      // Only the clear can produce this: the page was captured prefilled.
      await waitUntil(
        () => input(doc, '#username').value === '',
        'the cleared field to replay'
      )

      expect(input(doc, '#username').value).toBe('')
    })

    it('ticks the checkbox the test checked', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectMutation(loginTrace.rememberChecked)
      )
      await waitUntil(
        () => input(doc, '#remember').checked,
        'the checkbox to be ticked by the replay'
      )

      expect(input(doc, '#remember').checked).toBe(true)
    })

    it('unticks a checkbox whose captured state is false', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectMutation(loginTrace.rememberUnchecked)
      )
      // The typed username is the signal that the window replayed — the page was
      // captured with a different one. It cannot be keyed on the checkbox: the
      // captured box is unticked too. What makes the assertion below unambiguous
      // is the fixture TICKING the box earlier in the same window, so an unticked
      // box here can only be this mutation's work.
      await waitUntil(
        () => input(doc, '#username').value === TYPED_USERNAME,
        'the replay window to be applied'
      )

      const remember = input(doc, '#remember')
      // The property mirror is the half that is right, and the half the replayed
      // page is drawn from.
      expect(remember.checked).toBe(false)
      // SOURCE BUG, pinned as-is (snapshot.ts:464 `setAttribute` runs for every
      // attribute mutation, before the property mirror on :470). `checked` is a
      // BOOLEAN content attribute — its presence means checked whatever the value
      // — so the replayed markup says TICKED while the property says otherwise.
      // On screen the property wins, so replay is unaffected; anything that
      // re-serializes the page (export, copy-as-HTML, outerHTML round-trip) reads
      // the lie. Asserted through a real re-parse rather than the attribute's
      // spelling, so a fix flips a visible assertion instead of sneaking past:
      // the correct value is `null`, and `reticked` then becomes false.
      const reticked = new DOMParser()
        .parseFromString(remember.outerHTML, 'text/html')
        .querySelector<HTMLInputElement>('#remember')!
      expect(remember.getAttribute('checked')).toBe('false')
      expect(reticked.checked).toBe(true)
    })

    it('moves the radio selection to the option the test picked', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectMutation(loginTrace.planSelected)
      )
      await waitUntil(
        () => input(doc, '#plan-member').checked,
        'the radio move to replay'
      )

      expect(input(doc, '#plan-member').checked).toBe(true)
      expect(input(doc, '#plan-guest').checked).toBe(false)
    })

    it('carries on replaying when a mutation targets an element that is not on the page', async () => {
      const el = await mountBrowser(orphanTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectMutation(orphanTrace.usernameTyped)
      )
      await waitUntil(
        () => input(doc, '#username').value === TYPED_USERNAME,
        'the mutation after the orphan to replay'
      )

      expect(input(doc, '#username').value).toBe(TYPED_USERNAME)
    })
  })

  describe('command selection', () => {
    it('shows the page a navigating click produced, not the one it left', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () => selectCommand(loginTrace.submit))

      expect(doc.querySelector('#flash')).toBeTruthy()
      expect(doc.querySelector('form#login')).toBeNull()
    })

    it("follows the selected command's page in the address bar", async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      await replayAfter(el, () => selectCommand(loginTrace.submit))
      // The re-render that repaints the address bar is requested at the END of
      // the replay, so awaiting one render can still read the previous page.
      await waitUntil(
        () => text(shadow(el, ADDRESS_BAR)) === SECURE_URL,
        'the address bar to follow the selection'
      )

      expect(text(shadow(el, ADDRESS_BAR))).toBe(SECURE_URL)
    })

    it('rebuilds the earlier page when an earlier command is selected again', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      await replayAfter(el, () => selectCommand(loginTrace.submit))

      const doc = await replayAfter(el, () =>
        selectCommand(loginTrace.openLogin)
      )

      expect(doc.querySelector('form#login')).toBeTruthy()
      // The field mutations belong to a later command, so the input is back to
      // the value the page was captured with.
      expect(input(doc, '#username').value).toBe(STALE_USERNAME)
    })

    it('falls back to the first capture for a command that ran before any DOM was captured', async () => {
      const el = await mountBrowser(preCaptureTrace)
      await replayedPage(el)
      await replayAfter(el, () => selectCommand(preCaptureTrace.waitForForm))

      const doc = await replayAfter(el, () =>
        selectCommand(preCaptureTrace.launchSession)
      )

      expect(doc.querySelector('form#login')).toBeTruthy()
    })

    it('replays a text change recorded as a character-data mutation', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectCommand(loginTrace.readFlash)
      )
      // The text arrives after the secure-page anchor, so the anchor landing is
      // not enough to read it.
      await waitUntil(
        () => doc.querySelector('#flash')?.textContent === FLASH_TEXT,
        'the flash text to replay'
      )

      expect(doc.querySelector('#flash')?.textContent).toBe(FLASH_TEXT)
    })
  })

  /**
   * A characterData record's target is the mutated Text NODE, which carries no
   * `data-wdio-ref` of its own, so the collector addresses it as its parent
   * element's ref plus the node's index among that parent's childNodes. These
   * cases pin both halves: that the addressed node is the one patched, and that
   * a mutation the address does not resolve leaves the parent alone rather than
   * writing over its children.
   */
  describe('text changes', () => {
    /** The class change closing every text stream — uniquely true once the whole
     *  walk has run, so a text change that never landed cannot read as an
     *  unfinished replay. */
    const wholeWindowApplied = (doc: Document) =>
      waitUntil(
        () => doc.querySelector('#flash')?.className === 'success dismissed',
        'the whole replay window to be applied'
      )

    const replayTextTrace = async (scenario: TextTrace) => {
      const el = await mountBrowser(scenario)
      await replayedPage(el)
      const doc = await replayAfter(el, () => selectCommand(scenario.readFlash))
      await wholeWindowApplied(doc)
      return doc
    }

    it('patches only the addressed text node of a mixed-content parent', async () => {
      const doc = await replayTextTrace(textNodeTrace)

      const notice = doc.querySelector('#notice')!
      // Text, element, text — the child list the capture recorded, still intact.
      expect(
        Array.from(notice.childNodes).map((node) => node.nodeName)
      ).toEqual(['#text', 'STRONG', '#text'])
      expect(notice.childNodes[0].textContent).toBe(NOTICE_LEAD)
      expect(notice.childNodes[2].textContent).toBe(NOTICE_TAIL_UPDATED)
      // The element child and its own text survive: a parent-level `textContent`
      // write would have deleted both.
      expect(doc.querySelector('#who')?.textContent).toBe(NOTICE_WHO)
    })

    it('replaces the text of a node the page rewrote through its parent', async () => {
      const doc = await replayTextTrace(textNodeTrace)

      // Exactly the new text: the removed Text node reaches the replay as a null
      // ref, and an entry it fails to drop leaves the old text alongside.
      expect(doc.querySelector('#flash')?.textContent).toBe(FLASH_TEXT)
    })

    it('falls back to the only text child when the captured index has shifted', async () => {
      const doc = await replayTextTrace(looseTextTrace)

      expect(doc.querySelector('#flash')?.textContent).toBe(FLASH_TEXT)
    })

    it('leaves the parent alone for a text mutation carrying no address', async () => {
      const doc = await replayTextTrace(looseTextTrace)

      // Nothing to patch, so nothing changes — the parent keeps its element
      // child and both of its text children.
      const notice = doc.querySelector('#notice')!
      expect(notice.childNodes[0].textContent).toBe(NOTICE_LEAD)
      expect(notice.childNodes[2].textContent).toBe(NOTICE_TAIL)
      expect(doc.querySelector('#who')?.textContent).toBe(NOTICE_WHO)
    })
  })

  // The fixture documents a DOM window per command in prose; `mutationForCommand`
  // is what actually decides them. Asserting the windows keeps those claims
  // honest — a fixture timestamp that stopped meaning what it says would
  // otherwise silently move which page every replay case above observes.
  describe('the DOM window a command resolves to', () => {
    const windowFor = (command: CommandLog, scenario: TraceScenario) =>
      mutationForCommand(command, scenario.commands, scenario.mutations)

    it('ends a command at the last mutation before the next one starts', () => {
      expect(windowFor(loginTrace.openLogin, loginTrace)).toBe(
        loginTrace.loginDocument
      )
    })

    it('gives the fill command the whole field batch that followed it', () => {
      expect(windowFor(loginTrace.typeUsername, loginTrace)).toBe(
        loginTrace.planSelected
      )
    })

    it('reaches past a navigating click to the page it produced', () => {
      expect(windowFor(loginTrace.submit, loginTrace)).toBe(
        loginTrace.securePageDocument
      )
    })

    it('leaves the last command unbounded', () => {
      expect(windowFor(loginTrace.readFlash, loginTrace)).toBe(
        loginTrace.flashText
      )
    })

    it('falls back to the first capture for a command that predates every mutation', () => {
      expect(windowFor(preCaptureTrace.launchSession, preCaptureTrace)).toBe(
        preCaptureTrace.mutations[0]
      )
    })
  })

  describe('added and removed nodes', () => {
    it('inserts an added node at its captured position', async () => {
      const el = await mountBrowser(validationTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectCommand(validationTrace.submitInvalid)
      )
      await waitUntil(
        () => doc.querySelector('#error') !== null,
        'the added node to replay'
      )

      const error = doc.querySelector('#error')
      expect(error).toBeTruthy()
      expect(error?.parentElement?.id).toBe('login')
      expect(error?.nextElementSibling?.id).toBe('submit')
    })

    it('removes a node the page dropped', async () => {
      const el = await mountBrowser(validationTrace)
      await replayedPage(el)

      const doc = await replayAfter(el, () =>
        selectCommand(validationTrace.submitInvalid)
      )
      // The captured page has the checkbox, so its absence is the removal.
      await waitUntil(
        () => doc.querySelector('#remember') === null,
        'the removed node to disappear from the replay'
      )

      expect(doc.querySelector('#remember')).toBeNull()
      expect(doc.querySelectorAll('input')).toHaveLength(4)
    })
  })

  describe('screenshot fallback for a trace without DOM', () => {
    it("shows the selected command's own screenshot", async () => {
      const el = await mountBrowser(domlessTrace)
      selectCommand(domlessTrace.navigate)
      await settle(el)

      expect(shadow(el, SCREENSHOT)?.getAttribute('src')).toBe(
        `data:image/png;base64,${LOGIN_SHOT}`
      )
    })

    it("falls back to the preceding command's frame for a command that captured none", async () => {
      const el = await mountBrowser(domlessTrace)
      selectCommand(domlessTrace.assertFlash)
      await settle(el)

      expect(shadow(el, SCREENSHOT)?.getAttribute('src')).toBe(
        `data:image/png;base64,${SECURE_SHOT}`
      )
    })

    it('shows the latest captured frame before any command is selected', async () => {
      const el = await mountBrowser(domlessTrace)
      await settle(el)

      expect(shadow(el, SCREENSHOT)?.getAttribute('src')).toBe(
        `data:image/png;base64,${SECURE_SHOT}`
      )
    })

    it('resolves the address bar from the last navigation command', async () => {
      const el = await mountBrowser(domlessTrace)
      selectCommand(domlessTrace.clickSubmit)
      await settle(el)

      expect(text(shadow(el, ADDRESS_BAR))).toBe(LOGIN_URL)
    })

    it('renders the placeholder when neither DOM nor screenshot was captured', async () => {
      const el = await mountBrowser()
      await settle(el)

      expect(shadowAll(el, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(el, SCREENSHOT)).toHaveLength(0)
      expect(el.iframe).toBeFalsy()
    })

    it('renders the placeholder for commands that captured no frames', async () => {
      const el = await mountBrowser({ commands: loginTrace.commands })
      selectCommand(loginTrace.submit)
      await settle(el)

      expect(shadowAll(el, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(el, SCREENSHOT)).toHaveLength(0)
    })
  })

  describe('element overlay', () => {
    /**
     * The accessible name the overlay hands the A11y tab per box, collected by
     * hovering every box in turn — the only way out of the component, and the
     * same value a click carries.
     */
    async function overlayNames(
      el: Browser
    ): Promise<Record<string, string | undefined>> {
      const names: Record<string, string | undefined> = {}
      const listener = (event: Event) => {
        const detail = (
          event as CustomEvent<{ selector: string; label?: string } | null>
        ).detail
        if (detail) {
          names[detail.selector] = detail.label
        }
      }
      window.addEventListener('a11y-reveal', listener)
      try {
        for (const box of boxesIn(el, OVERLAY_BOX)) {
          box.dispatchEvent(new MouseEvent('mouseenter'))
        }
      } finally {
        window.removeEventListener('a11y-reveal', listener)
      }
      return names
    }

    /**
     * The a11y tree keys its rows on the accessible name, so every box carries
     * one — approximated from `aria-label`, else the visible text, else the
     * placeholder. The captured page holds one element per branch, which is what
     * stops this passing with the whole fallback deleted (it would then name
     * every box `''`).
     */
    it("names each box by the element's accessible name", async () => {
      const el = await mountBrowser(overlayLabelTrace)
      await replayedPage(el)

      shadow(el, OVERLAY_TOGGLE)?.click()

      expect(await overlayNames(el)).toEqual({
        '#username': USERNAME_PLACEHOLDER,
        '#submit': LOGIN_LABEL,
        '#cancel': CANCEL_ARIA_LABEL,
        '#password': UNNAMED_LABEL
      })
    })

    it("prefers an element's aria-label over the text it displays", async () => {
      const el = await mountBrowser(overlayLabelTrace)
      const doc = await replayedPage(el)

      shadow(el, OVERLAY_TOGGLE)?.click()

      // The element really does display text, so the aria-label winning is
      // precedence rather than there being nothing else to read...
      expect(doc.querySelector('#cancel')?.textContent).toBe(CANCEL_TEXT)
      expect((await overlayNames(el))['#cancel']).toBe(CANCEL_ARIA_LABEL)
      // ...and the captured attribute is padded, so the name is trimmed too.
      expect(doc.querySelector('#cancel')?.getAttribute('aria-label')).not.toBe(
        CANCEL_ARIA_LABEL
      )
    })

    it('boxes only the command locators that resolve on the replayed page', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      shadow(el, OVERLAY_TOGGLE)?.click()

      // `#flash` is on the secure page and the url command's argument is no
      // locator at all, so neither draws a box.
      expect(boxesIn(el, OVERLAY_BOX).map((box) => text(box))).toEqual([
        '#username',
        '#submit'
      ])
    })

    it('clears the boxes when the overlay is switched off again', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      const toggle = shadow(el, OVERLAY_TOGGLE)

      toggle?.click()
      toggle?.click()

      expect(boxesIn(el, OVERLAY_BOX)).toHaveLength(0)
    })

    it('asks the A11y tab to reveal the locator of the box clicked', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      shadow(el, OVERLAY_TOGGLE)?.click()

      const opened = new Promise<string | undefined>((resolve) => {
        window.addEventListener(
          'open-dock-tab',
          (event) =>
            resolve((event as CustomEvent<{ label?: string }>).detail?.label),
          { once: true }
        )
      })
      const revealed = new Promise<unknown>((resolve) => {
        window.addEventListener(
          'a11y-reveal',
          (event) => resolve((event as CustomEvent<unknown>).detail),
          { once: true }
        )
      })
      boxesIn(el, OVERLAY_BOX)[0].click()

      expect(await opened).toBe('A11y')
      expect(await revealed).toEqual({
        selector: '#username',
        // The accessible name that goes with it — the field's placeholder, since
        // an input carries no text of its own.
        label: USERNAME_PLACEHOLDER,
        pin: true
      })
    })

    it('offers no overlay toggle for a trace without DOM', async () => {
      const el = await mountBrowser(domlessTrace)
      await settle(el)

      expect(shadowAll(el, OVERLAY_TOGGLE)).toHaveLength(0)
    })
  })

  describe('highlighting', () => {
    it('outlines the element of the mutation being hovered', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      hoverMutation(loginTrace.usernameTyped)

      expect(boxesIn(el, HIGHLIGHT_BOX)).toHaveLength(1)
    })

    it('drops the outline when the hover ends', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      hoverMutation(loginTrace.usernameTyped)
      hoverMutation(null)

      expect(boxesIn(el, HIGHLIGHT_BOX)).toHaveLength(0)
    })

    it('outlines the element an a11y row points at', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      revealFromA11y('#submit')

      expect(boxesIn(el, HIGHLIGHT_BOX)).toHaveLength(1)
    })

    it('outlines the element an a11y text locator points at', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      // The form the a11y tree captures its own locators in — querySelector
      // cannot parse it, so only the shared resolver finds the element.
      revealFromA11y(`button*=${LOGIN_LABEL}`)

      expect(boxesIn(el, HIGHLIGHT_BOX)).toHaveLength(1)
    })

    it('outlines nothing for an a11y locator absent from the replayed page', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      // Same locator syntax as above, so this is about the page not carrying
      // the text — not about the syntax being unparseable.
      revealFromA11y('button*=Log out')

      expect(boxesIn(el, HIGHLIGHT_BOX)).toHaveLength(0)
    })
  })

  describe('screencast view', () => {
    const withRecording = () =>
      mountBrowser({
        commands: loginTrace.commands,
        mutations: loginTrace.mutations,
        metadataBySession: recordedSessionMetadata
      })

    it("plays an arriving recording and shows that session's page URL", async () => {
      const el = await withRecording()
      await replayedPage(el)

      recordingArrives()
      await settle(el)

      expect(shadow(el, SCREENCAST)?.getAttribute('src')).toBe(
        `/api/video/${VIDEO_SESSION_ID}`
      )
      expect(text(shadow(el, ADDRESS_BAR))).toBe(SECURE_URL)
      expect(texts(el, VIEW_BUTTON)).toEqual(['Snapshot', 'Screencast'])
    })

    it('returns to the DOM replay when Snapshot is selected', async () => {
      const el = await withRecording()
      await replayedPage(el)
      recordingArrives()
      await settle(el)

      shadowAll(el, VIEW_BUTTON)[0].click()
      await settle(el)

      expect(shadowAll(el, SCREENCAST)).toHaveLength(0)
      expect(el.iframe).toBeTruthy()
      expect(text(shadow(el, ADDRESS_BAR))).toBe(LOGIN_URL)
    })

    it('offers no view toggle before a recording arrives', async () => {
      const el = await mountBrowser(loginTrace)
      await settle(el)

      expect(shadowAll(el, VIEW_BUTTON)).toHaveLength(0)
    })

    it('offers one picker option per recording it holds', async () => {
      const el = await withRecording()
      await replayedPage(el)

      recordingArrives()
      recordingArrives()
      await settle(el)

      // The signal the re-connect case below reads: a player that took one
      // recording twice shows a second option here.
      expect(shadowAll(el, RECORDING_OPTION)).toHaveLength(2)
    })
  })

  /**
   * Re-connecting is Lit's contract, not an edge case — the workbench swaps the
   * player between its player-mode host and the plain pane, and every window
   * listener it registers on connect outlives the element unless connect and
   * disconnect stay symmetric.
   */
  describe('re-connecting', () => {
    /** Removes the player from its mount, handing back the host to re-attach to. */
    function detach(el: Browser): HTMLElement {
      const host = el.parentElement
      if (!host) {
        throw new Error('the mounted player has no host to re-attach it to')
      }
      el.remove()
      return host
    }

    it('takes an arriving recording once after being re-connected', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      detach(el).append(el)
      await settle(el)

      recordingArrives()
      await settle(el)

      // Exactly once: a registration that only runs on the first connect leaves
      // the re-connected player deaf, and one that stacks takes the recording
      // twice — which shows up as a picker for two.
      expect(shadowAll(el, SCREENCAST)).toHaveLength(1)
      expect(shadowAll(el, RECORDING_OPTION)).toHaveLength(0)
    })

    it('stops taking recordings while it is detached', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)
      const host = detach(el)

      recordingArrives()

      host.append(el)
      // Renders whatever it collected while detached, without depending on a
      // detached element having rendered on its own.
      el.requestUpdate()
      await settle(el)

      expect(shadowAll(el, SCREENCAST)).toHaveLength(0)
      expect(shadowAll(el, VIEW_BUTTON)).toHaveLength(0)
    })
  })

  /**
   * The replay iframe is laid out at the CAPTURED viewport and scaled to fit the
   * pane, so the page inside sees the width it was recorded at — its breakpoints
   * and media queries resolve the way they did during the run — however small the
   * panel is. Every other case in this spec reads the replayed DOM only, so the
   * whole sizing pass could be deleted and they would all still pass.
   */
  describe('viewport sizing', () => {
    /** The in-flow box that gives the absolutely-positioned, scaled iframe a
     *  footprint for the wrapper to centre. */
    const SIZER = '.iframe-sizer'

    /** Host padding the sizing subtracts, measured off the element rather than
     *  assumed from the stylesheet's rem value. */
    function hostPadding(el: Browser): { x: number; y: number } {
      const style = getComputedStyle(el)
      return {
        x: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        y: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      }
    }

    const headerHeight = (el: Browser) =>
      shadow(el, 'header')!.getBoundingClientRect().height

    /** The scale the player put on the iframe, read off the COMPUTED transform —
     *  so an equivalent spelling still passes and a wrong factor still fails. */
    const scaleOf = (iframe: HTMLIFrameElement) =>
      new DOMMatrixReadOnly(getComputedStyle(iframe).transform).a

    function frame(el: Browser): HTMLIFrameElement {
      if (!el.iframe) {
        throw new Error('the player rendered no replay iframe')
      }
      return el.iframe
    }

    /**
     * Sizes the pane the player sits in and waits for the re-scale. The transform
     * is cleared first so the wait is for the player writing it again, not for a
     * value this test hopes to read — the geometry itself is never predicted here.
     */
    async function resizePane(
      el: Browser,
      width: number,
      height: number
    ): Promise<HTMLIFrameElement> {
      const host = el.parentElement
      if (!host) {
        throw new Error('the mounted player has no pane to size')
      }
      const iframe = frame(el)
      iframe.style.transform = ''
      host.style.width = `${width}px`
      host.style.height = `${height}px`
      window.dispatchEvent(new Event('resize'))
      await waitUntil(
        () => iframe.style.transform !== '',
        'the iframe to be re-scaled to the pane'
      )
      return iframe
    }

    /** Pane leaving `usable` px of width and height for the replay, on top of
     *  the host padding and browser chrome the player subtracts. */
    const paneFor = (el: Browser, usable: { w: number; h: number }) =>
      [
        hostPadding(el).x + usable.w,
        hostPadding(el).y + headerHeight(el) + usable.h
      ] as const

    it('lays the replay out at the captured viewport, scaled into the pane', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      // 640 usable px for a 1280px capture — half — with height to spare, so the
      // width is what constrains the fit.
      const iframe = await resizePane(el, ...paneFor(el, { w: 640, h: 600 }))

      // The page is laid out at the size it was recorded at...
      expect(iframe.style.width).toBe(`${CAPTURED_VIEWPORT.width}px`)
      expect(iframe.style.height).toBe(`${CAPTURED_VIEWPORT.height}px`)
      // ...and drawn at half of it, filling the width it was given.
      expect(scaleOf(iframe)).toBeCloseTo(0.5, 5)
      const box = iframe.getBoundingClientRect()
      expect(box.width).toBeCloseTo(640, 1)
      expect(box.height).toBeCloseTo(400, 1)
    })

    it('shrinks the replay to the pane height when that is what constrains it', async () => {
      const el = await mountBrowser({
        ...loginTrace,
        metadata: metadataForViewport(640, 480)
      })
      await replayedPage(el)

      // All 640 px of the capture's width available, but a quarter of its height.
      const iframe = await resizePane(el, ...paneFor(el, { w: 640, h: 120 }))

      expect(iframe.style.width).toBe('640px')
      expect(iframe.style.height).toBe('480px')
      expect(scaleOf(iframe)).toBeCloseTo(0.25, 5)
      // Fits the height exactly and leaves width to spare — a fit taken from the
      // width alone would draw it 640×480 and overflow the pane by 360px.
      const box = iframe.getBoundingClientRect()
      expect(box.height).toBeCloseTo(120, 1)
      expect(box.width).toBeCloseTo(160, 1)
    })

    it('magnifies a capture smaller than the pane rather than boxing it in', async () => {
      const el = await mountBrowser({
        ...loginTrace,
        metadata: metadataForViewport(320, 240)
      })
      await replayedPage(el)

      // Twice the capture's width fits, two and a half times its height.
      const iframe = await resizePane(el, ...paneFor(el, { w: 640, h: 600 }))

      expect(scaleOf(iframe)).toBeCloseTo(2, 5)
      expect(iframe.getBoundingClientRect().width).toBeCloseTo(640, 1)
    })

    it('gives the scaled iframe a footprint of its own drawn size', async () => {
      const el = await mountBrowser(loginTrace)
      await replayedPage(el)

      const iframe = await resizePane(el, ...paneFor(el, { w: 640, h: 600 }))

      // A transform leaves layout alone and the iframe is absolutely positioned,
      // so its own footprint is zero: without the sizer taking the scaled size
      // the wrapper has nothing to centre and a gutter opens beside the page.
      const box = iframe.getBoundingClientRect()
      const sizer = shadow(el, SIZER)!.getBoundingClientRect()
      expect(sizer.width).toBeCloseTo(box.width, 1)
      expect(sizer.height).toBeCloseTo(box.height, 1)
      // And the scaled box starts at the sizer's corner rather than shrinking
      // towards its middle.
      expect(box.left).toBeCloseTo(sizer.left, 1)
      expect(box.top).toBeCloseTo(sizer.top, 1)
    })

    it('falls back to a 1280×800 layout when the metadata carries no viewport', async () => {
      const el = await mountBrowser({
        commands: loginTrace.commands,
        mutations: loginTrace.mutations,
        metadata: viewportlessMetadata
      })
      await replayedPage(el)

      const iframe = await resizePane(el, ...paneFor(el, { w: 640, h: 600 }))

      // The player's own default — nothing in this mount carries a size.
      expect(iframe.style.width).toBe('1280px')
      expect(iframe.style.height).toBe('800px')
      expect(scaleOf(iframe)).toBeCloseTo(0.5, 5)
    })
  })

  describe('address-bar fallbacks', () => {
    it('falls back to the metadata URL when the capture carries none', async () => {
      const el = await mountBrowser({
        mutations: urllessTrace.mutations,
        metadata: urlMetadata
      })
      await replayedPage(el)
      await settle(el)

      expect(text(shadow(el, ADDRESS_BAR))).toBe(METADATA_URL)
    })

    it("shows 'unknown' when neither the capture nor the metadata has a URL", async () => {
      // The default metadata carries a viewport only.
      const el = await mountBrowser({ mutations: urllessTrace.mutations })
      await replayedPage(el)
      await settle(el)

      expect(text(shadow(el, ADDRESS_BAR))).toBe('unknown')
    })
  })
})
