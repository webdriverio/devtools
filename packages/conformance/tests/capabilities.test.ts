import { describe, expect, it } from 'vitest'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  ADAPTER_COLUMNS,
  CAPABILITIES,
  INTERNAL_RULES
} from '../src/capabilities.js'
import { optionProblems } from '../src/capability-options.js'
import { parseArgs, syncTables, targetsFor } from '../src/capability-matrix.js'
import {
  rowProblems,
  ruleCoverageProblems,
  validateCapabilities
} from '../src/capability-validation.js'
import { CAPABILITY_TABLES, LEGEND, RULES } from '../src/constants.js'
import {
  markerFor,
  renderBlock,
  renderTable,
  replaceBlock,
  superscript
} from '../src/render-capabilities.js'
import type {
  AdapterId,
  Capability,
  CapabilityTable,
  Cell,
  RuleId
} from '../src/types.js'

const allCells = (cell: Cell): Record<AdapterId, Cell> => ({
  'devtools-service': cell,
  'selenium-devtools': cell,
  'nightwatch-devtools': cell,
  'selenium-devtools-py': cell
})

const capability = (over: Partial<Capability> = {}): Capability => ({
  id: 'probe',
  name: 'Probe',
  tables: ['cross-framework'],
  cells: allCells({ support: 'supported' }),
  ...over
})

describe('validateCapabilities', () => {
  it('accepts the declared source', () => {
    expect(validateCapabilities()).toEqual([])
  })

  it('rejects an empty reason', () => {
    const blank = capability({
      cells: {
        ...allCells({ support: 'supported' }),
        'selenium-devtools': { support: 'partial', reason: '  ' }
      }
    })
    expect(rowProblems([blank])).toEqual([
      'probe / selenium-devtools: a reason is required'
    ])
  })

  it('rejects a proven cell whose rule does not exist', () => {
    const unknown = capability({
      cells: allCells({ support: 'proven', rules: ['no-such-rule' as RuleId] })
    })
    expect(rowProblems([unknown])).toContain(
      'probe / devtools-service: unknown rule no-such-rule'
    )
  })

  it('rejects a proven cell the adapter holds a known gap against', () => {
    const gapped = capability({
      cells: allCells({ support: 'proven', rules: [RULES.documentAnchored] })
    })
    const problems = rowProblems([gapped])
    expect(problems).toContain(
      'probe / selenium-devtools: every-document-anchored is a known gap (bidi: off)'
    )
    expect(problems.some((p) => p.startsWith('probe / devtools-service'))).toBe(
      false
    )
  })

  it('rejects a missing adapter, a duplicate id and a row in no table', () => {
    const { 'selenium-devtools-py': _python, ...three } = allCells({
      support: 'supported'
    })
    const missing = capability({ cells: three as Record<AdapterId, Cell> })
    expect(rowProblems([missing, capability({ tables: [] })])).toEqual([
      'probe: no cell for selenium-devtools-py',
      'probe: declared twice',
      'probe: appears in no table'
    ])
  })
})

describe('rule coverage', () => {
  it('flags a rule that proves nothing and is not internal', () => {
    expect(ruleCoverageProblems([capability()], {})).toContain(
      `rule ${RULES.metadataFirst}: proves no capability and is not listed as internal`
    )
  })

  it('flags an internal rule without a reason, or one that also proves a cell', () => {
    const proven = capability({
      cells: allCells({ support: 'proven', rules: [RULES.metadataFirst] })
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
  it('flags an option that names a capability nobody declared', () => {
    expect(optionProblems([])).toContain(
      'option shared.mode: names unknown capability trace-mode'
    )
  })

  it('places every option of the declared source', () => {
    expect(optionProblems(CAPABILITIES)).toEqual([])
  })
})

describe('renderTable', () => {
  it('has a column for every adapter', () => {
    const header = renderTable('cross-framework').split('\n')[0]
    expect(header).toBe(
      `| Capability | ${ADAPTER_COLUMNS.map((a) => a.title).join(' | ')} |`
    )
  })

  it('marks proven cells and adds the legend only when a row has one', () => {
    const proven = capability({
      cells: allCells({ support: 'proven', rules: [RULES.failureRecorded] })
    })
    expect(renderTable('cross-framework', [proven])).toContain(
      '| Probe | ✅ tested | ✅ tested | ✅ tested | ✅ tested |'
    )
    expect(renderTable('cross-framework', [proven])).toContain(LEGEND)
    expect(renderTable('cross-framework', [capability()])).not.toContain(LEGEND)
  })

  it('numbers each distinct reason once and lists it under the table', () => {
    const rows = [
      capability({
        cells: {
          ...allCells({ support: 'supported' }),
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
        '| Capability | WebdriverIO | Selenium | Nightwatch | Python |',
        '|---|---|---|---|---|',
        '| Probe | ✅ | ⚠️ with BiDi ¹ | ⚠️ ¹ | ❌ n/a ² |',
        '',
        '¹ Same.',
        '',
        '² Other.'
      ].join('\n')
    )
  })

  it('renders only the rows declared for that table', () => {
    const mobile = renderTable('mobile')
    for (const row of CAPABILITIES) {
      expect(mobile.includes(`| ${row.name} |`)).toBe(
        row.tables.includes('mobile')
      )
    }
  })

  it('writes multi-digit footnote numbers', () => {
    expect(superscript(12)).toBe('¹²')
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
      websiteRoot: path.resolve('a')
    })
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
      expect(CAPABILITIES.some((c) => c.tables.includes(table as never))).toBe(
        true
      )
    }
  })

  // Run `pnpm docs:capabilities` when this fails.
  it('README.md matches the declared source', () => {
    expect(syncTables(targetsFor(), true)).toEqual([])
  })
})
