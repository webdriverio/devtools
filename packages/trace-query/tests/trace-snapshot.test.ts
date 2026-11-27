import type { CommandLog } from '@wdio/devtools-shared'
import { describe, expect, it } from 'vitest'
import { traceStateOf } from '../src/open-trace.js'
import { traceSnapshot } from '../src/trace-snapshot.js'
import {
  ANDROID_START_LOCATOR,
  capture,
  openNativeTrace
} from './page-state-traces.js'
import { allPages, openFixture, openWritten } from './traces.js'

// The failing assert reads the page and takes no capture, so it shows the navigation's.
const WEB = 'selenium-mocha-2026-11-10-ee505b9c.zip'
const NAVIGATION = 'call@12'
const FAILING_ASSERT = 'call@15'

const LOGIN_FORM = [
  'form',
  '      statictext "Username"',
  '      textbox "Username" ∈ "Username"  →  #username',
  '      statictext "Password"',
  '      textbox "Password" ∈ "Password"  →  #password',
  '  button "Login" ∈ "Use tomsmith and SuperSecretPassword! to log in."  →  //button[contains(., "Login")]'
]

const size = (value: unknown) => JSON.stringify(value).length

describe('traceSnapshot on a web trace', () => {
  it('returns the tree of an action that took its own capture', async () => {
    const snapshot = traceSnapshot(await openFixture(WEB), NAVIGATION)
    expect(snapshot).toMatchObject({
      callId: NAVIGATION,
      capture: {
        callId: NAVIGATION,
        title: 'Page.navigate("http://127.0.0.1:4567/login")',
        own: true
      },
      total: 8
    })
    expect(snapshot?.header).toMatch(
      /^\[Page: The Internet .* http:\/\/127\.0\.0\.1:4567\/login\]$/
    )
    expect(snapshot?.items).toEqual([
      'heading[2] "Login Page"',
      'heading[4] "Use tomsmith and SuperSecretPassword! to log in."',
      ...LOGIN_FORM
    ])
    expect(snapshot?.nextCursor).toBeUndefined()
  })

  it('shows an action with no capture of its own the latest earlier one, and says whose it is', async () => {
    const trace = await openFixture(WEB)
    const own = traceSnapshot(trace, NAVIGATION)
    const inherited = traceSnapshot(trace, FAILING_ASSERT)
    expect(inherited?.capture).toEqual({ ...own?.capture, own: false })
    expect(inherited?.items).toEqual(own?.items)
  })

  it('scopes the tree to the subtree under a locator', async () => {
    expect(
      traceSnapshot(await openFixture(WEB), FAILING_ASSERT, {
        locator: '#username'
      })
    ).toMatchObject({
      items: ['textbox "Username" ∈ "Username"  →  #username'],
      total: 1,
      matches: 1
    })
  })

  it('scopes the tree to the subtrees whose nodes name a text, ignoring case', async () => {
    const trace = await openFixture(WEB)
    const form = traceSnapshot(trace, FAILING_ASSERT, { text: 'FORM' })
    expect(form?.items).toEqual(LOGIN_FORM)
    expect(form?.matches).toBe(1)
    expect(
      traceSnapshot(trace, FAILING_ASSERT, { text: 'textbox' })?.matches
    ).toBe(2)
  })

  it('needs a node to match both the locator and the text when given both', async () => {
    expect(
      traceSnapshot(await openFixture(WEB), FAILING_ASSERT, {
        locator: '#username',
        text: 'statictext'
      })
    ).toMatchObject({ items: [], total: 0, matches: 0 })
  })

  it('refuses a callId the trace does not hold', async () => {
    const trace = await openFixture(WEB)
    expect(() => traceSnapshot(trace, 'call@999')).toThrow(
      'The trace has no action "call@999"'
    )
  })
})

describe('traceSnapshot within its budget', () => {
  const START = 1_700_000_000_000
  const tree = [
    '[Page: Catalogue, https://shop.example/]',
    ...Array.from(
      { length: 120 },
      (_, i) => `    link "Product ${i}"  →  //a[contains(., "Product ${i}")]`
    ),
    `    button "${'n'.repeat(4_000)}"  →  #${'l'.repeat(4_000)}`
  ].join('\n')

  async function catalogue() {
    return openWritten({
      commands: [
        {
          command: 'url',
          args: ['https://shop.example/'],
          startTime: START + 100,
          timestamp: START + 200
        }
      ],
      actionSnapshots: [capture(START + 200, tree)],
      startTime: START
    })
  }

  it('pages every line, each page whole within the budget', async () => {
    const trace = await catalogue()
    const callId = traceStateOf(trace).data.trace.commands[0]!.callId!
    const whole = traceSnapshot(trace, callId, { maxChars: 1_000_000 })!
    for (const maxChars of [1_000, 2_000, 5_000]) {
      const pages = allPages((cursor) =>
        traceSnapshot(trace, callId, { maxChars, cursor })!
      )
      expect(pages.length).toBeGreaterThan(1)
      for (const page of pages) {
        expect(size(page)).toBeLessThanOrEqual(maxChars)
      }
      const lines = pages.flatMap((page) => page.items)
      expect(lines).toHaveLength(whole.total)
      expect(lines.slice(0, 120)).toEqual(whole.items.slice(0, 120))
    }
  })

  it('cuts a line longer than its page, saying how long it was', async () => {
    const trace = await catalogue()
    const callId = traceStateOf(trace).data.trace.commands[0]!.callId!
    const [line] = traceSnapshot(trace, callId, {
      maxChars: 1_000,
      text: 'nnnn'
    })!.items
    expect(line).toMatch(/^button "n+… \(cut, 8015 chars\)$/)
  })

  it('refuses a cursor from the unscoped tree on a scoped one', async () => {
    const trace = await catalogue()
    const callId = traceStateOf(trace).data.trace.commands[0]!.callId!
    const { nextCursor } = traceSnapshot(trace, callId, { maxChars: 1_000 })!
    expect(nextCursor).toMatch(/^\d+\/121\/[0-9a-f]{8}$/)
    expect(() =>
      traceSnapshot(trace, callId, {
        maxChars: 1_000,
        text: 'link',
        cursor: nextCursor
      })
    ).toThrow(/different listing/)
  })
})

describe('traceSnapshot on the older-writer fixtures', () => {
  // Each failing or last action and the action whose capture it shows, read off each adapter's capture policy at that writer's version.
  it.each([
    [
      'nightwatch-bdd-2026-10-28-14977b93',
      'call@22',
      'call@21',
      'Element.waitForDisplayed("#flash")'
    ],
    [
      'nightwatch-bdd-2026-11-10-ee505b9c',
      'call@22',
      'call@20',
      'Element.click("button[type="submit"]")'
    ],
    [
      'python-pytest-2026-10-28-14977b93',
      'call@25',
      'call@24',
      'Page.getTitle()'
    ],
    [
      'python-pytest-2026-11-10-ee505b9c',
      'call@32',
      'call@29',
      'Page.navigate("{"url":"http://127.0.0.1:4567/login"}")'
    ],
    [
      'selenium-mocha-2026-10-28-14977b93',
      'call@13',
      'call@12',
      'Element.getText()'
    ],
    [
      'selenium-mocha-2026-11-10-ee505b9c',
      'call@15',
      'call@12',
      'Page.navigate("http://127.0.0.1:4567/login")'
    ],
    [
      'wdio-mocha-2026-10-28-14977b93',
      'call@13',
      'call@13',
      'expect.toHaveText("Your username is invalid!")'
    ],
    [
      'wdio-mocha-2026-11-10-ee505b9c',
      'call@6',
      'call@5',
      'Element.click("button[type="submit"]")'
    ]
  ])(
    "credits the capture %s's %s shows to %s",
    async (fixture, asked, owner, title) => {
      const snapshot = traceSnapshot(await openFixture(`${fixture}.zip`), asked)
      expect(snapshot?.capture).toMatchObject({
        callId: owner,
        title,
        own: asked === owner
      })
      expect(snapshot?.header).toMatch(/^\[Page/)
    }
  )
})

describe('traceSnapshot on a native app trace', () => {
  it('returns the tree the page source was turned into, with its locators', async () => {
    const snapshot = traceSnapshot(await openNativeTrace(), 'call@1')
    expect(snapshot).toMatchObject({
      header: '[android]',
      capture: { timeMs: 0, callId: 'call@1', own: true }
    })
    expect(snapshot?.items[0]).toBe('hierarchy')
    expect(snapshot?.items).toContain(
      `    button "Start"  →  ${ANDROID_START_LOCATOR}`
    )
  })

  it('shows a read that took no capture the tap before it', async () => {
    expect(
      traceSnapshot(await openNativeTrace(), 'call@2', {
        locator: ANDROID_START_LOCATOR
      })
    ).toMatchObject({
      callId: 'call@2',
      capture: { timeMs: 0, callId: 'call@1', own: false },
      matches: 1
    })
  })

  it('returns nothing for an action with no capture at or before it', async () => {
    expect(
      traceSnapshot(await openNativeTrace(undefined, []), 'call@1')
    ).toBeUndefined()
  })

  it('credits a capture to its action after zero-length rows shift every later row', async () => {
    const assertAt = (arg: string): CommandLog => ({
      command: 'assert.ok',
      args: [arg],
      startTime: 1200,
      timestamp: 1200
    })
    const trace = await openNativeTrace(
      [
        { command: 'click', args: ['~a'], startTime: 900, timestamp: 1000 },
        assertAt('a'),
        assertAt('b'),
        assertAt('c'),
        { command: 'click', args: ['~y'], startTime: 1200, timestamp: 1201 },
        { command: 'getText', args: ['~y'], startTime: 1300, timestamp: 1300 }
      ],
      [1000, 1201]
    )
    const { commands } = traceStateOf(trace).data.trace
    const tapY = commands.find((c) => c.title === 'Element.click("~y")')!
    expect(tapY.startTime).toBeGreaterThan(1201)
    expect(
      commands.map((c) => {
        const { capture: source } = traceSnapshot(trace, c.callId!)!
        return [c.title, source.callId, source.timeMs]
      })
    ).toEqual([
      ['Element.click("~a")', 'call@1', 0],
      ['assert.ok("a")', 'call@1', 0],
      ['assert.ok("b")', 'call@1', 0],
      ['assert.ok("c")', 'call@1', 0],
      ['Element.click("~y")', tapY.callId, 201],
      ['Element.getText("~y")', tapY.callId, 201]
    ])
  })
})
