import fs from 'node:fs'

/**
 * One test/suite definition discovered in a source file by line-regex scan.
 * Adapter-agnostic shape — both selenium and nightwatch consume this.
 */
export interface TestDefinition {
  kind: 'suite' | 'test'
  title: string
  line: number
}

/**
 * Regex-scan a JS/TS test file for `describe('...')` / `it('...')` style
 * definitions (and Mocha/Jest aliases — `suite`, `context`, `test`,
 * `specify`). Adapters call this from line-based helpers that resolve a
 * call-source `file:line` for the dashboard's TestLens / Actions tab.
 *
 * Set `includeNightwatchObjectStyle` to also match the object-export shape
 * Nightwatch's `--yes` scaffolder generates:
 *
 *     'My test name': () => { ... }
 *     'My test name': async function () { ... }
 *
 * Returns definitions in source order. Unreadable / unparseable files yield
 * an empty array — the dashboard already degrades to `file:0` in that case.
 */
export function findTestDefinitions(
  filePath: string,
  opts: { includeNightwatchObjectStyle?: boolean } = {}
): TestDefinition[] {
  if (!fs.existsSync(filePath)) {
    return []
  }
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const out: TestDefinition[] = []
  const lines = source.split('\n')

  const suiteRe = /\b(?:describe|suite|context)\s*\(\s*['"`]([^'"`]+)['"`]/
  const testRe = /\b(?:it|test|specify)\s*\(\s*['"`]([^'"`]+)['"`]/
  // Nightwatch object-export: `'Title': () => { ... }` or `: function () {`
  const objRe =
    /^\s*['"`]([^'"`]+)['"`]\s*:\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\s*\()/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    const suiteMatch = line.match(suiteRe)
    if (suiteMatch) {
      out.push({ kind: 'suite', title: suiteMatch[1], line: lineNum })
      continue
    }
    const testMatch = line.match(testRe)
    if (testMatch) {
      out.push({ kind: 'test', title: testMatch[1], line: lineNum })
      continue
    }
    if (opts.includeNightwatchObjectStyle) {
      const objMatch = line.match(objRe)
      if (objMatch) {
        out.push({ kind: 'test', title: objMatch[1], line: lineNum })
      }
    }
  }
  return out
}

/**
 * Convenience: find the line number where a specific test/suite is defined.
 * Returns null if the file or title isn't found. Used by adapter call-source
 * resolution from hooks where the user's stack frame isn't reachable.
 */
export function findTestLineInFile(
  filePath: string,
  title: string,
  kind: 'test' | 'suite' = 'test'
): number | null {
  const defs = findTestDefinitions(filePath)
  return defs.find((d) => d.kind === kind && d.title === title)?.line ?? null
}
