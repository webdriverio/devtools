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
/** An expect-webdriverio failure puts each half of its diff on its own line. */
const FLASH_EXPECTED = 'Expected: "You logged into a secure area!"'
const FLASH_RECEIVED = 'Received: "Your username is invalid!"'
const FLASH_ERROR = `${FLASH_EXPECTED}\n${FLASH_RECEIVED}`
/** How the panel writes that failure: the message's second line is indented by
 *  the width of the `- ` marker, keeping it inside its list item. */
const FLASH_FAILURE_ITEM = `- ${FLASH_ASSERTION}: ${FLASH_EXPECTED}\n  ${FLASH_RECEIVED}`

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

/** A runner error carrying terminal colour — node's AssertionError diff is
 *  colour-coded, and an escape sequence is noise in a prompt. */
const ANSI_ERROR =
  '\x1b[31mExpected:\x1b[39m "secure area"\n\x1b[2K\x1b[32mReceived:\x1b[39m "invalid"'
const ANSI_ERROR_LINES = [
  'Expected: "secure area"',
  'Received: "invalid"'
] as const

const failingColouredAssertion: CommandLog = commandLog({
  command: 'expect.toHaveText',
  title: 'expect("#flash").toHaveText(…)',
  args: ['#flash'],
  error: { name: 'AssertionError', message: ANSI_ERROR }
})

/** A stack-shaped message: a blank line separates the summary from the frames,
 *  so the item spans a paragraph break. */
const STACK_ERROR = 'element not interactable\n\n    at click (spec.ts:12:3)'

const failingWithStack: CommandLog = commandLog({
  command: 'click',
  args: ['button[type=submit]'],
  error: { name: 'Error', message: STACK_ERROR }
})

/** A multi-line *label*: the value typed into the field carried a newline, so
 *  the display title the player built spans two lines. */
const MULTILINE_TITLE = 'setValue("#comment", "first line\nsecond line")'

const failingMultilineTitle: CommandLog = commandLog({
  command: 'setValue',
  title: MULTILINE_TITLE,
  args: ['#comment', 'first line\nsecond line'],
  error: { name: 'Error', message: 'element not interactable' }
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

    // `transcript.md` inlines the runner's own error text, so the colour comes
    // through the file as well as through a command's error.
    it('copies a transcript free of the terminal colour it was written with', async () => {
      const writes = recordClipboard()
      const coloured = `${TRANSCRIPT}\n- \x1b[31mERROR: element not found\x1b[39m`
      const panel = await mountTranscript(coloured)
      await clickCopy(panel)

      expect(writes).toEqual([`${TRANSCRIPT}\n- ERROR: element not found`])
    })

    it('appends a failures section built from the commands that errored', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        passingNavigation,
        failingAssertion
      ])
      await clickCopy(panel)

      expect(writes).toEqual([
        `${TRANSCRIPT}\n\n## Failures\n${FLASH_FAILURE_ITEM}`
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

    // The whole array is asserted, not `[0]`/`[1]`: indexing plus `toContain`
    // is what let an unattributed `Received:` line at the top level of the
    // document go unnoticed.
    it('keeps the tail of a multi-line error inside its own failure bullet', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        failingClick,
        failingAssertion
      ])
      await clickCopy(panel)

      const failures = failureLines(writes[0])
      expect(failures).toEqual([
        '- click: element not interactable',
        `- ${FLASH_ASSERTION}: ${FLASH_EXPECTED}`,
        `  ${FLASH_RECEIVED}`
      ])
      // Two commands failed, so the list carries exactly two bullets, and every
      // other line is indented under the one above it — nothing escapes.
      expect(failures.filter((line) => line.startsWith('- '))).toHaveLength(2)
      expect(
        failures.filter((line) => !line.startsWith('- ') && line !== '')
      ).toEqual([`  ${FLASH_RECEIVED}`])
    })

    it('strips terminal colour codes out of a failure message', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        failingColouredAssertion
      ])
      await clickCopy(panel)

      expect(failureLines(writes[0])).toEqual([
        `- ${FLASH_ASSERTION}: ${ANSI_ERROR_LINES[0]}`,
        `  ${ANSI_ERROR_LINES[1]}`
      ])
      expect(writes[0]).not.toContain('\x1b')
    })

    it('keeps a blank line inside the bullet blank rather than indenting it', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [failingWithStack])
      await clickCopy(panel)

      expect(failureLines(writes[0])).toEqual([
        '- click: element not interactable',
        '',
        '      at click (spec.ts:12:3)'
      ])
    })

    it('indents a failure whose own label spans two lines', async () => {
      const writes = recordClipboard()
      const panel = await mountTranscript(TRANSCRIPT, [
        failingMultilineTitle,
        failingRead
      ])
      await clickCopy(panel)

      const [labelHead, labelTail] = MULTILINE_TITLE.split('\n')
      expect(failureLines(writes[0])).toEqual([
        `- ${labelHead}`,
        `  ${labelTail}: element not interactable`,
        '- getText: element not found'
      ])
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
