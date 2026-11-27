import {
  commandIndicesIn,
  effectiveFailure,
  stepOutcome,
  TRACE_OUTCOME,
  type CommandLog,
  type TraceActionChild,
  type TraceActionGroupNode,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { clipText } from './budget.js'
import { MAX_TITLE_CHARS } from './constants.js'
import type { FailedStep, TestNode } from './types.js'

function stepsIn(
  children: readonly TraceActionChild[]
): TraceActionGroupNode[] {
  return children.flatMap((child) => ('group' in child ? [child.group] : []))
}

function allSteps(
  children: readonly TraceActionChild[]
): TraceActionGroupNode[] {
  return stepsIn(children).flatMap((step) => [step, ...allSteps(step.children)])
}

/** The suites, tests and steps of the action tree, each with its outcome. */
export function testTree(
  data: TracePlayerData,
  retried: ReadonlySet<CommandLog>
): TestNode[] {
  const build = (step: TraceActionGroupNode): TestNode => {
    const children = stepsIn(step.children).map(build)
    return {
      callId: step.callId,
      title: clipText(step.title, MAX_TITLE_CHARS),
      outcome: stepOutcome(step, data.trace.commands, retried),
      ...(children.length ? { children } : {})
    }
  }
  return stepsIn(data.groups ?? []).map(build)
}

/** The innermost steps whose own end carried an error that no failed row under them explains, such as a failing hook. */
export function stepsFailedOnTheirOwn(
  data: TracePlayerData,
  retried: ReadonlySet<CommandLog>
): FailedStep[] {
  const { commands } = data.trace
  const unexplained = allSteps(data.groups ?? []).filter(
    (step): step is FailedStep =>
      step.error !== undefined &&
      !commandIndicesIn(step.children).some((index) =>
        effectiveFailure(commands[index], retried)
      )
  )
  const listed = new Set<TraceActionGroupNode>(unexplained)
  // A wrapper step and the step inside it can both carry one error; the innermost names where it happened.
  return unexplained.filter(
    (step) => !allSteps(step.children).some((inner) => listed.has(inner))
  )
}

function countNodes(nodes: readonly TestNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countNodes(node.children ?? []),
    0
  )
}

/** The tree cut to its failed branches, and how many nodes that left out. */
export function failedBranches(nodes: readonly TestNode[]): {
  kept: TestNode[]
  omitted: number
} {
  let omitted = 0
  const prune = (level: readonly TestNode[]): TestNode[] =>
    level.flatMap((node) => {
      const { children, ...own } = node
      if (node.outcome !== TRACE_OUTCOME.FAILED) {
        omitted += countNodes([node])
        return []
      }
      const kept = prune(children ?? [])
      return [kept.length ? { ...own, children: kept } : own]
    })
  return { kept: prune(nodes), omitted }
}

// Each kept node pays for its own fields, a separator and a `children` key, so the kept tree serializes within the budget.
const CHILDREN_KEY_CHARS = '"children":[],'.length

/** The tree in order, as far as it fits the budget, and how many nodes that left out. */
export function treeWithin(
  nodes: readonly TestNode[],
  budget: number
): { kept: TestNode[]; omitted: number } {
  let used = 2
  let omitted = 0
  const take = (level: readonly TestNode[]): TestNode[] =>
    level.flatMap((node) => {
      const { children, ...own } = node
      const cost = JSON.stringify(own).length + 1 + CHILDREN_KEY_CHARS
      if (used + cost > budget) {
        omitted += countNodes([node])
        return []
      }
      used += cost
      const kept = take(children ?? [])
      return [kept.length ? { ...own, children: kept } : own]
    })
  return { kept: take(nodes), omitted }
}

/** The `trace.commands` positions under the step a callId names; refuses one the tree does not hold. */
export function commandsOfStep(
  data: TracePlayerData,
  callId: string
): Set<number> {
  const step = allSteps(data.groups ?? []).find(
    (candidate) => candidate.callId === callId
  )
  if (!step) {
    throw new Error(
      `The trace has no test or step ${JSON.stringify(callId)}: pass a callId from the summary's tests`
    )
  }
  return new Set(commandIndicesIn(step.children))
}

/** The titles of the steps a row ran in, outermost first. */
export function stepPathOf(data: TracePlayerData, index: number): string[] {
  const walk = (
    children: readonly TraceActionChild[],
    path: string[]
  ): string[] | undefined => {
    for (const child of children) {
      if (!('group' in child)) {
        if (commandIndicesIn([child]).includes(index)) {
          return path
        }
        continue
      }
      const found = walk(child.group.children, [...path, child.group.title])
      if (found) {
        return found
      }
    }
    return undefined
  }
  return walk(data.groups ?? [], []) ?? []
}
