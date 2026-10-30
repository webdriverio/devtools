import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { CSP_VIOLATION_PREFIX } from '../hosted-player/constants.js'
import {
  diffTitles,
  failingLogEntry,
  missingCspDirectives,
  readFormatFixtures,
  requestedWorker,
  rowLabelToTitle,
  TRACE_FORMAT_FIXTURES
} from '../hosted-player/expectations.js'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('readFormatFixtures', () => {
  it('pairs every committed fixture zip with its manifest titles', () => {
    const fixtures = readFormatFixtures()
    const zips = fs
      .readdirSync(TRACE_FORMAT_FIXTURES)
      .filter((file) => file.endsWith('.zip'))
    expect(fixtures.map((fixture) => path.basename(fixture.zipPath))).toEqual(
      [...zips].sort()
    )
    for (const fixture of fixtures) {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(TRACE_FORMAT_FIXTURES, `${fixture.name}.json`),
          'utf8'
        )
      ) as { commands: { count: number } }
      expect(fixture.titles).toHaveLength(manifest.commands.count)
      expect(fixture.titles).toEqual([...fixture.titles].sort())
    }
  })

  it('refuses a zip with no manifest beside it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-fixtures-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'orphan.zip'), '')
    expect(() => readFormatFixtures(dir)).toThrow(/orphan\.json/)
  })
})

describe('rowLabelToTitle', () => {
  it.each([
    ['Expect.toHaveText("x")', 'expect.toHaveText("x")'],
    ['Assert.equal()', 'assert.equal()'],
    ['Verify.ok()', 'verify.ok()'],
    ['  Element.click()  ', 'Element.click()'],
    ['Page.navigate("http://a/Expect.x")', 'Page.navigate("http://a/Expect.x")']
  ])('reads %j as %j', (label, title) => {
    expect(rowLabelToTitle(label)).toBe(title)
  })
})

describe('diffTitles', () => {
  it('matches labels the player capitalised', () => {
    expect(
      diffTitles(
        ['expect.toBe()', 'Element.click()'],
        ['Element.click()', 'Expect.toBe()']
      )
    ).toEqual({ missing: [], unexpected: [] })
  })

  it('counts a repeated title', () => {
    expect(
      diffTitles(['Element.click()', 'Element.click()'], ['Element.click()'])
    ).toEqual({ missing: ['Element.click()'], unexpected: [] })
    expect(
      diffTitles(['Element.click()'], ['Element.click()', 'Element.click()'])
    ).toEqual({ missing: [], unexpected: ['Element.click()'] })
  })

  it('names a row the trace does not hold', () => {
    expect(diffTitles([], ['Page.reload()'])).toEqual({
      missing: [],
      unexpected: ['Page.reload()']
    })
  })
})

describe('missingCspDirectives', () => {
  it('passes the policy vercel.json sends', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')
    ) as { headers: { headers: { key: string; value: string }[] }[] }
    const csp = config.headers
      .flatMap(({ headers }) => headers)
      .find(({ key }) => key.toLowerCase() === 'content-security-policy')
    expect(csp).toBeDefined()
    expect(missingCspDirectives(csp?.value ?? null)).toEqual([])
  })

  it('names what an absent or looser policy lacks', () => {
    expect(missingCspDirectives(null)).toEqual([
      "script-src 'self'",
      "connect-src 'self'"
    ])
    expect(
      missingCspDirectives(
        "default-src 'self'; script-src 'self' 'unsafe-eval'"
      )
    ).toEqual(["script-src 'self'", "connect-src 'self'"])
  })

  it('reads directives regardless of spacing', () => {
    expect(
      missingCspDirectives("script-src  'self' ;connect-src 'self'")
    ).toEqual([])
  })
})

describe('failingLogEntry', () => {
  it('ignores anything below error', () => {
    for (const level of ['debug', 'info', 'warn']) {
      expect(failingLogEntry({ level, text: 'x', type: 'console' })).toBe(
        undefined
      )
    }
  })

  it('names a console error and an uncaught exception', () => {
    expect(
      failingLogEntry({ level: 'error', text: 'boom', type: 'console' })
    ).toBe('console error: boom')
    expect(
      failingLogEntry({
        level: 'error',
        text: 'TypeError: x',
        type: 'javascript'
      })
    ).toBe('uncaught exception: TypeError: x')
    expect(failingLogEntry({ level: 'error', text: null })).toBe(
      'console error: (no message)'
    )
  })

  it('names a CSP violation the page reported', () => {
    expect(
      failingLogEntry({
        level: 'error',
        text: `${CSP_VIOLATION_PREFIX} worker-src blocked blob at http://x/:0`,
        type: 'console'
      })
    ).toBe('CSP violation: worker-src blocked blob at http://x/:0')
  })
})

describe('requestedWorker', () => {
  it('finds the emitted parse worker', () => {
    expect(
      requestedWorker([
        'http://127.0.0.1:4173/assets/index-BW0mUuR7.js',
        'http://127.0.0.1:4173/assets/trace-parse.worker-DhTVtLb-.js'
      ])
    ).toBe('http://127.0.0.1:4173/assets/trace-parse.worker-DhTVtLb-.js')
    expect(
      requestedWorker([
        'https://trace.webdriver.io/assets/trace-parse.worker-a1.js?v=2'
      ])
    ).toBeDefined()
  })

  it('does not take the in-page reader chunk or a source path for it', () => {
    expect(
      requestedWorker([
        'http://127.0.0.1:4173/assets/trace-parse-BFfS2wVz.js',
        'http://127.0.0.1:4173/src/controller/trace-parse.worker.ts'
      ])
    ).toBe(undefined)
  })
})
