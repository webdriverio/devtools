import { describe, expect, it } from 'vitest'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { FEATURES } from '../src/features.js'
import { ADAPTER_COLUMNS, INTERNAL_RULES } from '../src/capabilities.js'
import { optionProblems } from '../src/capability-options.js'
import { parseArgs, syncTables, targetsFor } from '../src/capability-matrix.js'
import {
  rowProblems,
  ruleCoverageProblems,
  validateFeatures
} from '../src/capability-validation.js'
import { CAPABILITY_TABLES, LEGEND, RULES } from '../src/constants.js'
import {
  markerFor,
  renderBlock,
  renderParity,
  renderTable,
  replaceBlock,
  superscript
} from '../src/render-capabilities.js'
import type {
  AdapterId,
  CapabilityTable,
  Cell,
  Feature,
  RuleId
} from '../src/types.js'

const BY_HAND: Cell = {
  support: 'supported',
  evidence: { kind: 'manual', reason: 'Check by hand.' }
}
const byRule = (rules: RuleId[]): Cell => ({
  support: 'supported',
  evidence: { kind: 'rule', rules }
})
const byTest = (path: string): Cell => ({
  support: 'supported',
  evidence: { kind: 'test', path }
})

const allCells = (cell: Cell): Record<AdapterId, Cell> => ({
  'devtools-service': cell,
  'selenium-devtools': cell,
  'nightwatch-devtools': cell,
  'selenium-devtools-py': cell
})

const feature = (over: Partial<Feature> = {}): Feature => ({
  id: 'probe',
  name: 'Probe',
  tables: ['cross-framework'],
  cells: allCells(BY_HAND),
  ...over
})

describe('validateFeatures', () => {
  it('accepts the declared source', () => {
    expect(validateFeatures()).toEqual([])
  })

  it('rejects an empty reason', () => {
    const blank = feature({
      cells: {
        ...allCells(BY_HAND),
        'selenium-devtools': { support: 'partial', reason: '  ' }
      }
    })
    expect(rowProblems([blank])).toEqual([
      'probe / selenium-devtools: a reason is required'
    ])
  })

  it('rejects rule evidence naming a rule that does not exist', () => {
    const unknown = feature({
      cells: allCells(byRule(['no-such-rule' as RuleId]))
    })
    expect(rowProblems([unknown])).toContain(
      'probe / devtools-service: unknown rule no-such-rule'
    )
  })

  it('rejects rule evidence the adapter holds a known gap against', () => {
    const gapped = feature({
      cells: allCells(byRule([RULES.documentAnchored]))
    })
    const problems = rowProblems([gapped])
    expect(problems).toContain(
      'probe / selenium-devtools: every-document-anchored is a known gap (bidi: off)'
    )
    expect(problems.some((p) => p.startsWith('probe / devtools-service'))).toBe(
      false
    )
  })

  it('rejects a test path that does not exist and manual evidence without a reason', () => {
    const row = feature({
      cells: {
        ...allCells(BY_HAND),
        'devtools-service': byTest('packages/service/tests/no-such.test.ts'),
        'selenium-devtools': {
          support: 'supported',
          evidence: { kind: 'manual', reason: ' ' }
        }
      }
    })
    expect(rowProblems([row])).toEqual([
      'probe / devtools-service: test packages/service/tests/no-such.test.ts does not exist',
      'probe / selenium-devtools: manual evidence needs the reason no test covers it'
    ])
  })

  it("rejects a test outside the adapter's own and the shared packages' tests, and a directory", () => {
    const row = feature({
      cells: {
        ...allCells(BY_HAND),
        'devtools-service': byTest(
          'packages/selenium-devtools/tests/session.test.ts'
        ),
        'selenium-devtools': byTest('packages/selenium-devtools/src/index.ts'),
        'nightwatch-devtools': byTest(
          'packages/nightwatch-devtools/tests/../../../package.json'
        ),
        'selenium-devtools-py': byTest('packages/core/tests/')
      }
    })
    const problems = rowProblems([row])
    expect(problems).toHaveLength(4)
    expect(problems[0]).toContain('is outside packages/service/tests/')
    expect(problems[1]).toContain(
      'is outside packages/selenium-devtools/tests/'
    )
    expect(problems[2]).toContain(
      'is outside packages/nightwatch-devtools/tests/'
    )
    expect(problems[3]).toBe(
      'probe / selenium-devtools-py: test packages/core/tests/ is not a file'
    )
  })

  it('reports malformed evidence instead of throwing', () => {
    const row = feature({
      cells: {
        ...allCells(BY_HAND),
        'devtools-service': { support: 'supported' } as Cell,
        'selenium-devtools': {
          support: 'supported',
          evidence: { kind: 'tests', path: 'x' }
        } as unknown as Cell,
        'nightwatch-devtools': {
          support: 'supported',
          evidence: { kind: 'manual' }
        } as unknown as Cell
      }
    })
    expect(rowProblems([row])).toEqual([
      'probe / devtools-service: supported without evidence',
      'probe / selenium-devtools: evidence of unknown kind tests',
      'probe / nightwatch-devtools: manual evidence needs the reason no test covers it'
    ])
  })

  it('accepts a test file in the adapter tests or a shared package', () => {
    const row = feature({
      cells: allCells(byTest('packages/core/tests/trace-finalizer.test.ts'))
    })
    expect(rowProblems([row])).toEqual([])
  })

  it('rejects a missing adapter, a duplicate id and a row in no table', () => {
    const { 'selenium-devtools-py': _python, ...three } = allCells(BY_HAND)
    const missing = feature({ cells: three as Record<AdapterId, Cell> })
    expect(rowProblems([missing, feature({ tables: [] })])).toEqual([
      'probe: no cell for selenium-devtools-py',
      'probe: declared twice',
      'probe: appears in no table'
    ])
  })
})

describe('rule coverage', () => {
  it('flags a rule that proves nothing and is not internal', () => {
    expect(ruleCoverageProblems([feature()], {})).toContain(
      `rule ${RULES.metadataFirst}: proves no feature and is not listed as internal`
    )
  })

  it('flags an internal rule without a reason, or one that also proves a cell', () => {
    const proven = feature({
      cells: allCells(byRule([RULES.metadataFirst]))
    })
    const problems = ruleCoverageProblems([proven], {
      ...INTERNAL_RULES,
      [RULES.metadataFirst]: 'Internal.',
      [RULES.failureRecorded]: ' '
    })
    expect(problems).toContain(
      `rule ${RULES.metadataFirst}: listed as internal but proves a cell`
    )
    expect(problems).toContain(
      `rule ${RULES.failureRecorded}: internal without a reason`
    )
  })
})

describe('option coverage', () => {
  it('flags an option that names a feature nobody declared', () => {
    expect(optionProblems([])).toContain(
      'option shared.mode: names unknown feature trace-mode'
    )
  })

  it('places every option of the declared source', () => {
    expect(optionProblems(FEATURES)).toEqual([])
  })
})

describe('renderTable', () => {
  it('has a column for every adapter', () => {
    const header = renderTable('cross-framework').split('\n')[0]
    expect(header).toBe(
      `| Feature | ${ADAPTER_COLUMNS.map((a) => a.title).join(' | ')} |`
    )
  })

  it('marks conformance-tested cells, and explains both marks under every table', () => {
    const proven = feature({
      cells: allCells(byRule([RULES.failureRecorded]))
    })
    expect(renderTable('cross-framework', [proven])).toContain(
      '| Probe | ✅ tested | ✅ tested | ✅ tested | ✅ tested |'
    )
    expect(renderTable('cross-framework', [feature()])).toContain(
      `| Probe | ✅ | ✅ | ✅ | ✅ |\n\n${LEGEND}`
    )
  })

  it('numbers each distinct reason once and lists it under the table', () => {
    const rows = [
      feature({
        cells: {
          ...allCells(BY_HAND),
          'selenium-devtools': {
            support: 'partial',
            label: 'with BiDi',
            reason: 'Same.'
          },
          'nightwatch-devtools': { support: 'partial', reason: 'Same.' },
          'selenium-devtools-py': {
            support: 'unsupported',
            label: 'n/a',
            reason: 'Other.'
          }
        }
      })
    ]
    expect(renderTable('cross-framework', rows)).toBe(
      [
        '| Feature | WebdriverIO | Selenium | Nightwatch | Python |',
        '|---|---|---|---|---|',
        '| Probe | ✅ | ⚠️ with BiDi ¹ | ⚠️ ¹ | ❌ n/a ² |',
        '',
        LEGEND,
        '',
        '¹ Same.',
        '',
        '² Other.'
      ].join('\n')
    )
  })

  it('renders only the rows declared for that table', () => {
    const mobile = renderTable('mobile')
    const rows: readonly Feature[] = FEATURES
    for (const row of rows) {
      expect(mobile.includes(`| ${row.name} |`)).toBe(
        row.tables.includes('mobile')
      )
    }
  })

  it('writes multi-digit footnote numbers', () => {
    expect(superscript(12)).toBe('¹²')
  })
})

describe('renderParity', () => {
  it('lists each feature some adapter lacks, with its mark and reason, then the evidence counts', () => {
    const rows = [
      feature(),
      feature({
        id: 'gap',
        name: 'Gap',
        cells: {
          ...allCells(byRule([RULES.failureRecorded])),
          'nightwatch-devtools': {
            support: 'partial',
            label: 'opt-in',
            reason: 'Why.'
          }
        }
      })
    ]
    expect(renderParity(rows)).toBe(
      [
        'Features not supported by every adapter: 1 of 2',
        '',
        'gap: Gap',
        '  Nightwatch: ⚠️ opt-in. Why.',
        '',
        'Cells: 3 conformance-tested, 0 unit-tested, 4 checked by hand, 1 partial or unsupported'
      ].join('\n')
    )
  })
})

describe('replaceBlock', () => {
  it('replaces only what sits between the markers', () => {
    const page = [
      'before',
      '<!-- capability-matrix:mobile:start -->',
      'stale',
      '<!-- capability-matrix:mobile:end -->',
      'after'
    ].join('\n')
    expect(replaceBlock(page, 'mobile')).toBe(
      `before\n${renderBlock('mobile')}\nafter`
    )
  })

  it('names the marker lines to insert when the page has none', () => {
    expect(() => replaceBlock('no table here', 'mobile')).toThrow(
      `insert the lines ${markerFor('mobile', 'start')} and ${markerFor('mobile', 'end')}`
    )
  })

  it('refuses a duplicated block and a reversed pair, each with its own message', () => {
    const block = `${markerFor('mobile', 'start')}\n${markerFor('mobile', 'end')}`
    expect(() => replaceBlock(`${block}\n${block}`, 'mobile')).toThrow(
      '2 start and 2 end markers'
    )
    expect(() =>
      replaceBlock(
        `${markerFor('mobile', 'end')}\n${markerFor('mobile', 'start')}`,
        'mobile'
      )
    ).toThrow('comes before')
  })
})

describe('docs:capabilities arguments', () => {
  it('takes the website path in either form', () => {
    expect(parseArgs(['--website', 'a']).websiteRoot).toBe(path.resolve('a'))
    expect(parseArgs(['--website=a', '--check'])).toEqual({
      check: true,
      parity: false,
      websiteRoot: path.resolve('a')
    })
    expect(parseArgs(['--parity']).parity).toBe(true)
  })

  it('rejects a flag or nothing as the website path', () => {
    expect(() => parseArgs(['--website', '--check'])).toThrow('needs the path')
    expect(() => parseArgs(['--website'])).toThrow('needs the path')
    expect(() => parseArgs(['--website='])).toThrow('needs the path')
  })
})

describe('syncTables', () => {
  const tables: CapabilityTable[] = ['readme-trace', 'readme-mobile']
  const blocks = tables
    .map((t) => `${markerFor(t, 'start')}\nstale\n${markerFor(t, 'end')}`)
    .join('\n')

  it('writes a file once with all of its tables, and writes nothing when any target fails', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'capabilities-'))
    try {
      const good = path.join(dir, 'good.md')
      const bad = path.join(dir, 'bad.md')
      writeFileSync(good, blocks)
      writeFileSync(bad, 'no markers')
      const targets = [
        ...tables.map((table) => ({ table, file: good })),
        { table: 'mobile' as const, file: bad }
      ]
      expect(() => syncTables(targets, false)).toThrow('bad.md')
      expect(readFileSync(good, 'utf8')).toBe(blocks)

      expect(syncTables(targets.slice(0, 2), false)).toEqual([good])
      expect(readFileSync(good, 'utf8')).toBe(
        tables.map((t) => renderBlock(t)).join('\n')
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing file before writing anything', () => {
    expect(() =>
      syncTables([{ table: 'mobile', file: '/nonexistent/page.md' }], true)
    ).toThrow('not found')
  })
})

describe('generated tables', () => {
  it('every table has at least one row', () => {
    for (const table of Object.keys(CAPABILITY_TABLES)) {
      expect(FEATURES.some((f) => f.tables.includes(table as never))).toBe(true)
    }
  })

  // Run `pnpm docs:capabilities` when this fails.
  it('README.md matches the declared source', () => {
    expect(syncTables(targetsFor(), true)).toEqual([])
  })
})
