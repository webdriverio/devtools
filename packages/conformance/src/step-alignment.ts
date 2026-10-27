import { SCENARIO_TESTS } from './constants.js'
import type { Lacks, NormalizedStep } from './types.js'

/** Steps only one side shows, between two steps both show. */
export interface Hunk {
  /** The last step both sides showed before it, if any. */
  after?: NormalizedStep
  a: NormalizedStep[]
  b: NormalizedStep[]
}

/** One scenario test's steps on both sides: the pairs both show, and the hunks between them. */
export interface AlignedTest {
  test: number
  pairs: [NormalizedStep, NormalizedStep][]
  hunks: Hunk[]
}

export const stepKey = (s: NormalizedStep) => `${s.action} ${s.target}`.trim()

/** Whether a lack names this step: by its action, or by its action and target. */
export function lacked(lacks: Lacks, step: NormalizedStep): boolean {
  return (
    lacks.steps.includes(step.action) || lacks.steps.includes(stepKey(step))
  )
}

export function testLabel(test: number): string {
  return test === -1
    ? 'outside any test'
    : `test "${SCENARIO_TESTS[test]?.title ?? test}"`
}

/** Aligned within each scenario test, so a step is never paired with one from another test. */
export function alignSteps(
  a: NormalizedStep[],
  b: NormalizedStep[]
): AlignedTest[] {
  const tests = [...new Set([...a, ...b].map((s) => s.test))].sort(
    (x, y) => x - y
  )
  return tests.map((test) =>
    alignTest(
      test,
      a.filter((s) => s.test === test),
      b.filter((s) => s.test === test)
    )
  )
}

// A longest common subsequence, so one missing or extra step is one hunk and every step after it still pairs.
function alignTest(
  test: number,
  a: NormalizedStep[],
  b: NormalizedStep[]
): AlignedTest {
  const common = commonLengths(a.map(stepKey), b.map(stepKey))
  const pairs: AlignedTest['pairs'] = []
  const hunks: Hunk[] = []
  let hunk: Hunk = { a: [], b: [] }
  const flush = (after?: NormalizedStep) => {
    if (hunk.a.length || hunk.b.length) {
      hunks.push(hunk)
    }
    hunk = { after, a: [], b: [] }
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && stepKey(a[i]) === stepKey(b[j])) {
      flush(a[i])
      pairs.push([a[i++], b[j++]])
    } else if (
      j >= b.length ||
      (i < a.length && common[i + 1][j] >= common[i][j + 1])
    ) {
      hunk.a.push(a[i++])
    } else {
      hunk.b.push(b[j++])
    }
  }
  flush()
  return { test, pairs, hunks }
}

function commonLengths(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}
