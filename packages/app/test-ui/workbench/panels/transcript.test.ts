import type { CommandLog } from '@wdio/devtools-shared'

import { commandContext, transcriptContext } from '@/controller/context.js'
import '@components/workbench/transcript.js'
import type { DevtoolsTranscript } from '@components/workbench/transcript.js'

import { commandLog } from '../../support/builders.js'
import { mount, mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'

const PANEL = 'wdio-devtools-transcript'
const BODY = 'pre'
const COPY_BUTTON = 'button'
const COPY_ICON = 'icon-mdi-content-copy'
const COPIED_ICON = 'icon-mdi-check'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const EMPTY_ICON = '.empty-state-icon'
const EMPTY_HEADING = '.empty-state-text'
const EMPTY_DETAIL = '.empty-state-detail'
const SKELETON = '.ph-item'

/** Copy the panel hands its placeholder. The panel mounts in player mode only,
 *  over an already-loaded trace, so this is a terminal state — a skeleton here
 *  would never resolve. */
const EMPTY_GLYPH = '📝'
const EMPTY_HEADING_TEXT = 'No transcript in this trace'
const EMPTY_DETAIL_TEXT =
  'A run writes transcript.md from the steps it captured — this trace carries none, so there is no prompt to copy.'
/** Elements a markdown renderer would produce — the panel renders none. */
const MARKDOWN_ELEMENTS = 'h1, h2, ul, ol, li, strong, code'

const LOGIN_URL = 'https://the-internet.herokuapp.com/login'

/** A run transcript as the exporter writes `transcript.md`. */
const STEPS = [
  '# Login flow',
  '',
  '## Step 1 — open the login page',
  `- url("${LOGIN_URL}")`,
  '',
  '## Step 2 — sign in',
  '- setValue("#username", "tomsmith")',
  '- setValue("#password", "SuperSecretPassword!")',
  '- click("button[type=submit]")',
  '',
  '## Step 3 — assert the flash message',
  '- expect("#flash").toHaveText("You logged into a secure area!")'
]

const TRANSCRIPT = STEPS.join('\n')

const FLASH_ASSERTION = 'expect("#flash").toHaveText(…)'
const FLASH_ERROR =
  'Expected: "You logged into a secure area!"\nReceived: "Your username is invalid!"'

const failingAssertion: CommandLog = commandLog({
  command: 'expect.toHaveText',
  title: FLASH_ASSERTION,
  args: ['#flash'],
  error: { name: 'AssertionError', message: FLASH_ERROR }
})

const failingClick: CommandLog = commandLog({
  command: 'click',
  args: ['button[type=submit]'],
  error: { name: 'Error', message: 'element not interactable' }
})

/** A second failure whose message is a single line, so the list it lands in is
 *  well-formed — the contrast to `failingAssertion` below. */
const failingRead: CommandLog = commandLog({
  command: 'getText',
  args: ['#flash'],
  error: { name: 'Error', message: 'element not found' }
})

const passingNavigation: CommandLog = commandLog({
  command: 'url',
  args: [LOGIN_URL]
})

async function mountTranscript(
  transcript?: string,
  commands: CommandLog[] = []
): Promise<DevtoolsTranscript> {
  const panel = await mountWithContext<DevtoolsTranscript>(PANEL, [
    { context: transcriptContext, value: transcript },
    { context: commandContext, value: commands }
  ])
  await settle(panel)
  return panel
}

/** Rendered transcript with its line breaks intact — `text()` collapses them,
 *  and line order is the thing under test. */
const bodyLines = (panel: DevtoolsTranscript): string[] =>
  (shadow(panel, BODY)?.textContent ?? '').split('\n')

/** Lines of the copied prompt's Failures section, which the panel writes as a
 *  markdown list — one bullet per failing command. */
const failureLines = (prompt: string): string[] =>
  prompt.split('## Failures\n')[1].split('\n')

/** The panel copies through `navigator.clipboard`, which a headless run has no
 *  user gesture or permission for; the writes are recorded instead. */
function recordClipboard(options: { failing?: boolean } = {}): string[] {
  const writes: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (data: string): Promise<void> => {
        if (options.failing) {
          return Promise.reject(new Error('clipboard write blocked'))
        }
        writes.push(data)
        return Promise.resolve()
      }
    }
  })
  return writes
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** Lets the awaited clipboard write inside the click handler settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function clickCopy(panel: DevtoolsTranscript): Promise<void> {
  const button = shadow<HTMLButtonElement>(panel, COPY_BUTTON)
  if (!button) {
    throw new Error('the transcript rendered no copy button')
  }
  button.click()
  await flush()
  await settle(panel)
}

describe('wdio-devtools-transcript', () => {
  describe('transcript body', () => {
    it('renders every step in the order the transcript records them', async () => {
      const panel = await mountTranscript(TRANSCRIPT)

      expect(bodyLines(panel)).toEqual(STEPS)
    })

    it('renders the markdown as text rather than formatting it', async () => {
      const panel = await mountTranscript(TRANSCRIPT)

      expect(shadowAll(panel, MARKDOWN_ELEMENTS)).toHaveLength(0)
      expect(bodyLines(panel)).toContain('## Step 2 — sign in')
    })

    it('renders a single-step transcript on its own', async () => {
      const step = `- url("${LOGIN_URL}")`
      const panel = await mountTranscript(step)

      expect(bodyLines(panel)).toEqual([step])
    })

    it('renders the transcript verbatim, including its surrounding blank lines', async () => {
      const padded = `\n${TRANSCRIPT}\n`
      const panel = await mountTranscript(padded)

      expect(shadow(panel, BODY)?.textContent).toBe(padded)
    })
  })

  describe('absent transcript', () => {
    it('renders the placeholder when the run carried no transcript', async () => {
      const panel = await mountTranscript()

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, BODY)).toHaveLength(0)
    })

    // Read inside the placeholder's own shadow root: the panel's `textContent`
    // stops at the placeholder's host, so it reads empty whether or not the
    // words render — which is how inert copy went unnoticed.
    it('says why there is no transcript', async () => {
      const panel = await mountTranscript()
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(EMPTY_HEADING_TEXT)
      expect(text(shadow(placeholder, EMPTY_DETAIL))).toBe(EMPTY_DETAIL_TEXT)
      expect(text(shadow(placeholder, EMPTY_ICON))).toBe(EMPTY_GLYPH)
    })

    // The panel only mounts over a loaded trace, so a skeleton would spin for
    // the life of the tab.
    it('explains the empty panel instead of drawing a loading skeleton', async () => {
      const panel = await mountTranscript()
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(placeholder, SKELETON)).toHaveLength(0)
    })

    it('renders the placeholder before a provider supplies one', async () => {
      const panel = await mount<DevtoolsTranscript>(PANEL)
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(EMPTY_HEADING_TEXT)
    })

    it('renders the placeholder for an empty transcript', async () => {
      const panel = await mountTranscript('')
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(EMPTY_HEADING_TEXT)
    })

    it('offers no copy control while the placeholder is showing', async () => {
      const panel = await mountTranscript()

      expect(shadowAll(panel, COPY_BUTTON)).toHaveLength(0)
    })
  })

  describe('copy prompt', () => {
    it('offers a copy control describing what it copies', async () => {
      const panel = await mountTranscript(TRANSCRIPT)

      expect(shadowAll(panel, COPY_ICON)).toHaveLength(1)
      expect(shadow(panel, COPY_BUTTON)?.getAttribute('title')).toBe(
        'Copy the transcript + failures as an LLM prompt'
      )
    })

    it('copies the trimmed transcript when no command failed', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(`\n${TRANSCRIPT}\n`, [
        passingNavigation
      ])
      await clickCopy(panel)

      expect(writes).toEqual([TRANSCRIPT])
    })

    it('appends a failures section built from the commands that errored', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        passingNavigation,
        failingAssertion
      ])
      await clickCopy(panel)

      expect(writes).toEqual([
        `${TRANSCRIPT}\n\n## Failures\n- ${FLASH_ASSERTION}: ${FLASH_ERROR}`
      ])
    })

    it('names a failure after its command when it carries no title', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [failingClick])
      await clickCopy(panel)

      expect(writes[0]).toContain('- click: element not interactable')
    })

    it('lists one bullet per failing command, in the order they ran', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        failingClick,
        passingNavigation,
        failingRead
      ])
      await clickCopy(panel)

      expect(failureLines(writes[0])).toEqual([
        '- click: element not interactable',
        '- getText: element not found'
      ])
    })

    // SOURCE BUG, pinned as it behaves today: `transcript.ts`'s `#buildPrompt`
    // (:94-98) inlines the raw error message and joins the rows with '\n', so
    // the tail of a multi-line error lands outside the markdown list the prompt
    // is built as — an LLM reads an unattributed `Received:` line. Indenting or
    // escaping the continuation flips both assertions below.
    it('spills the tail of a multi-line error out of the failures list', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        failingClick,
        failingAssertion
      ])
      await clickCopy(panel)

      const [expectedLine, receivedLine] = FLASH_ERROR.split('\n')
      const failures = failureLines(writes[0])
      expect(failures).toEqual([
        '- click: element not interactable',
        `- ${FLASH_ASSERTION}: ${expectedLine}`,
        receivedLine
      ])
      // Two commands failed, so a well-formed list is two bullets on two lines.
      expect(failures.filter((line) => line.startsWith('- '))).toHaveLength(2)
      expect(failures).toHaveLength(3)
    })

    it('confirms the copy on the control itself', async () => {
      recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT)
      await clickCopy(panel)

      expect(shadowAll(panel, COPIED_ICON)).toHaveLength(1)
      expect(shadowAll(panel, COPY_ICON)).toHaveLength(0)
      expect(shadow(panel, COPY_BUTTON)?.classList.contains('copied')).toBe(
        true
      )
    })

    it('shows no confirmation when the clipboard rejects the write', async () => {
      recordClipboard({ failing: true })
      const panel = await mountTranscript(TRANSCRIPT)
      await clickCopy(panel)

      expect(shadowAll(panel, COPIED_ICON)).toHaveLength(0)
      expect(shadowAll(panel, COPY_ICON)).toHaveLength(1)
      expect(shadow(panel, COPY_BUTTON)?.classList.contains('copied')).toBe(
        false
      )
    })
  })
})
