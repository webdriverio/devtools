import { describe, it, expect } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { generateTranscript } from '../src/trace-transcript.js'

const ESC = ''
/** An expect-webdriverio failure: a headline, a blank line, then the coloured
 *  `Expected:`/`Received:` pair each on its own line. */
const MULTILINE_ERROR = [
  'Expect $(`#flash`) to have text',
  '',
  `Expected: "${ESC}[32mWelcome!${ESC}[39m"`,
  `Received: "${ESC}[31mYour username is invalid!${ESC}[39m"`
].join('\n')

function cmd(command: string, overrides: Partial<CommandLog> = {}): CommandLog {
  const base = (overrides.timestamp ?? 1000) + 100
  return {
    command,
    args: [],
    timestamp: base,
    startTime: overrides.startTime ?? base - 50,
    ...overrides
  }
}

const transcript = (commands: CommandLog[]) =>
  generateTranscript(commands, 1000, 'Test').split('\n')

const HEADING = '# Test — 1970-01-01T00:00:01.000Z'

/** Every line must be a step marker, a heading, blank, or indented under its
 *  step — an unindented tail line has escaped its list item and reads as
 *  top-level prose no longer attributed to the step that produced it. */
function unattributedLines(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      line !== '' &&
      !line.startsWith('#') &&
      !/^\d+\. /.test(line) &&
      !/^ /.test(line)
  )
}

describe('generateTranscript', () => {
  // Nightwatch enqueues an assert and issues the next command in the SAME
  // millisecond, so start times tie and only `sequence` — the issue counter —
  // separates them. buildActionEvents breaks the tie that way; the transcript
  // did not, so transcript.md could order the pair opposite to the Actions tree.
  it('breaks a start-time tie on issue order, like the action stream', () => {
    const lines = transcript([
      cmd('click', { startTime: 500, timestamp: 600, sequence: 9 }),
      cmd('assert.urlContains', { startTime: 500, timestamp: 550, sequence: 4 })
    ])
    const assertAt = lines.findIndex((l) => l.includes('urlContains'))
    const clickAt = lines.findIndex((l) => l.includes('click'))
    expect(assertAt).toBeGreaterThan(-1)
    expect(assertAt).toBeLessThan(clickAt)
  })

  it('orders commands by invocation time when captured out of order (Nightwatch batches asserts to test-end)', () => {
    // Array order puts a later navigation before an earlier-timestamped click,
    // mimicking Nightwatch buffering native asserts until test-end.
    const lines = transcript([
      cmd('url', { timestamp: 1100, startTime: 1050 }),
      cmd('url', { timestamp: 1300, startTime: 1250 }),
      cmd('click', { timestamp: 1200, startTime: 1150 })
    ])
    // Sorted by startTime: url(1050) → click(1150) → url(1250) — click is #2.
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Page.navigate()',
      '2. Element.click()',
      '3. Page.navigate()'
    ])
  })

  it('indents a multi-line error under its numbered step and strips ANSI', () => {
    const lines = transcript([
      cmd('click', {
        timestamp: 1100,
        startTime: 1050,
        error: { name: 'Error', message: MULTILINE_ERROR }
      })
    ])
    // Three spaces — the width of the `1. ` marker, which is what markdown
    // needs to keep a continuation inside an ordered list item.
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Element.click()  ERROR: Expect $(`#flash`) to have text',
      '',
      '   Expected: "Welcome!"',
      '   Received: "Your username is invalid!"'
    ])
    expect(unattributedLines(lines)).toEqual([])
  })

  it('indents a multi-line typed value under its numbered step', () => {
    const lines = transcript([
      cmd('setValue', {
        timestamp: 1100,
        startTime: 1050,
        args: ['#comment', 'line one\nline two\nline three']
      })
    ])
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Element.fill("#comment")  value="line one',
      '   line two',
      '   line three"'
    ])
    expect(unattributedLines(lines)).toEqual([])
  })

  it('indents a multi-line label — a captured `execute` script spans lines', () => {
    const lines = transcript([
      cmd('execute', {
        timestamp: 1100,
        startTime: 1050,
        args: ['const el = document.body\nreturn el.textContent']
      })
    ])
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Page.evaluate("const el = document.body',
      '   return el.textContent")'
    ])
    expect(unattributedLines(lines)).toEqual([])
  })

  it('matches the continuation indent to a two-digit marker', () => {
    // `10. ` is four columns wide; a fixed two- or three-space indent would
    // leave the tail outside the tenth item.
    const commands = Array.from({ length: 10 }, (_, i) =>
      cmd('click', { timestamp: 1100 + i * 10, startTime: 1050 + i * 10 })
    )
    commands[9] = cmd('setValue', {
      timestamp: 1190,
      startTime: 1140,
      args: ['#comment', 'first\nsecond']
    })
    const lines = transcript(commands)
    expect(lines.slice(-2)).toEqual([
      '10. Element.fill("#comment")  value="first',
      '    second"'
    ])
    expect(unattributedLines(lines)).toEqual([])
  })

  it('keeps every line attributed when a step carries both a multi-line value and a multi-line error', () => {
    const lines = transcript([
      cmd('setValue', {
        timestamp: 1100,
        startTime: 1050,
        args: ['#comment', 'typed\nover two lines'],
        error: { name: 'Error', message: MULTILINE_ERROR }
      }),
      cmd('click', { timestamp: 1200, startTime: 1150 })
    ])
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Element.fill("#comment")  value="typed',
      '   over two lines"  ERROR: Expect $(`#flash`) to have text',
      '',
      '   Expected: "Welcome!"',
      '   Received: "Your username is invalid!"',
      '2. Element.click()'
    ])
    expect(unattributedLines(lines)).toEqual([])
  })

  it('strips ANSI from a colour-coded label and a colour-coded typed value', () => {
    const lines = transcript([
      cmd('setValue', {
        timestamp: 1100,
        startTime: 1050,
        args: [`${ESC}[36m#comment${ESC}[39m`, `${ESC}[1msecret${ESC}[22m`]
      })
    ])
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Element.fill("#comment")  value="secret"'
    ])
  })

  it('drops a trailing newline in an error instead of emitting a bare blank tail', () => {
    const lines = transcript([
      cmd('click', {
        timestamp: 1100,
        startTime: 1050,
        error: { name: 'Error', message: 'boom\n' }
      })
    ])
    expect(lines).toEqual([HEADING, '', '1. Element.click()  ERROR: boom'])
  })

  it('renders a non-object error value', () => {
    const lines = transcript([
      cmd('click', {
        timestamp: 1100,
        startTime: 1050,
        error: 'plain failure' as unknown as CommandLog['error']
      })
    ])
    expect(lines).toEqual([
      HEADING,
      '',
      '1. Element.click()  ERROR: plain failure'
    ])
  })

  it('emits heading only when no command maps to an action', () => {
    expect(transcript([cmd('clearValue'), cmd('executeScript')])).toEqual([
      HEADING,
      ''
    ])
  })
})
