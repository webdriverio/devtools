// Rebuilds the collapsible action tree from the structural before events that
// buildCommands drops from the flat list: foreign runner steps (self-referencing
// stepId, nested via parentId) and our Tracing.tracingGroup markers (children
// linked via parentId). Library-call leaves attach to the group their stepId
// points at, and an action's children (a wait's reads) to that action's row;
// unreferenced commands surface at the root in chronological order.

import type {
  CommandLog,
  TraceActionChild,
  TraceActionCommandNode,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

import { REVERSE_ACTION_MAP } from './trace-reader-constants.js'
import type { AfterEvent, BeforeEvent } from './trace-reader-types.js'

/** An action in our vocabulary that other actions name as parentId issued them, so it stays a row; a foreign runner
 *  step is never one. */
function isActionParent(before: BeforeEvent | undefined): boolean {
  return (
    before !== undefined &&
    before.class !== 'Tracing' &&
    `${before.class}.${before.method}` in REVERSE_ACTION_MAP
  )
}

/** Runner steps mirrored by a library call (stepId) and parents of nested
 *  steps are structure — as command rows they duplicate or envelop actions. */
export function collectStructuralIds(
  befores: Map<string, BeforeEvent>
): Set<string> {
  const structural = new Set<string>()
  for (const before of befores.values()) {
    if (before.stepId && before.stepId !== before.callId) {
      structural.add(before.stepId)
    }
    if (before.parentId && !isActionParent(befores.get(before.parentId))) {
      structural.add(before.parentId)
    }
  }
  return structural
}

export function isStructuralBefore(
  before: BeforeEvent,
  structural: Set<string>
): boolean {
  return before.class === 'Tracing' || structural.has(before.callId)
}

function groupTitle(before: BeforeEvent): string {
  if (before.title) {
    return before.title
  }
  const name = before.params?.name
  return typeof name === 'string' ? name : before.method
}

// A before nests under its stepId wrapper (foreign library calls) or its
// parentId container (runner steps and our group markers), whichever exists.
function parentGroupOf(
  before: BeforeEvent,
  nodes: Map<string, TraceActionGroupNode>
): TraceActionGroupNode | undefined {
  if (before.stepId && before.stepId !== before.callId) {
    const wrapper = nodes.get(before.stepId)
    if (wrapper) {
      return wrapper
    }
  }
  return before.parentId ? nodes.get(before.parentId) : undefined
}

function childStartTime(child: TraceActionChild, commands: CommandLog[]) {
  if ('group' in child) {
    return child.group.startTime
  }
  const command = commands[child.commandIndex]
  return command.startTime ?? command.timestamp
}

const nestedChildren = (child: TraceActionChild) =>
  'group' in child ? child.group.children : child.children

function sortTreeChronologically(
  children: TraceActionChild[],
  commands: CommandLog[]
): void {
  children.sort(
    (a, b) => childStartTime(a, commands) - childStartTime(b, commands)
  )
  for (const child of children) {
    sortTreeChronologically(nestedChildren(child) ?? [], commands)
  }
}

// Post-order rollup: a group fails when its own after errored or any
// descendant group/command did. A row's own children judge nothing: a wait
// decides whether it failed, whatever one of its polls raised.
function rollupFailed(
  child: TraceActionChild,
  commands: CommandLog[]
): boolean {
  if (!('group' in child)) {
    return Boolean(commands[child.commandIndex].error)
  }
  let failed = Boolean(child.group.failed)
  for (const nested of child.group.children) {
    failed = rollupFailed(nested, commands) || failed
  }
  if (failed) {
    child.group.failed = true
  }
  return failed
}

function buildGroupNodes(
  befores: Map<string, BeforeEvent>,
  afters: Map<string, AfterEvent>
): Map<string, TraceActionGroupNode> {
  const structural = collectStructuralIds(befores)
  const nodes = new Map<string, TraceActionGroupNode>()
  for (const before of befores.values()) {
    if (!isStructuralBefore(before, structural)) {
      continue
    }
    const after = afters.get(before.callId)
    const node: TraceActionGroupNode = {
      callId: before.callId,
      title: groupTitle(before),
      startTime: before.startTime,
      endTime: after?.endTime ?? before.startTime,
      children: []
    }
    if (after?.error) {
      node.failed = true
    }
    nodes.set(before.callId, node)
  }
  return nodes
}

function loopsBack(
  before: BeforeEvent,
  befores: Map<string, BeforeEvent>
): boolean {
  const seen = new Set<string>()
  for (
    let id = before.parentId;
    id && !seen.has(id);
    id = befores.get(id)?.parentId
  ) {
    if (id === before.callId) {
      return true
    }
    seen.add(id)
  }
  return false
}

// A before nests under a group (parentGroupOf), else under the action row its parentId names.
function containerOf(
  before: BeforeEvent,
  groups: Map<string, TraceActionGroupNode>,
  rows: Map<string, TraceActionCommandNode>
): TraceActionChild[] | undefined {
  const group = parentGroupOf(before, groups)
  if (group) {
    return group.children
  }
  const row = before.parentId ? rows.get(before.parentId) : undefined
  if (!row) {
    return undefined
  }
  row.children ??= []
  return row.children
}

/** Build the action tree, or undefined when the zip has no structural steps and no action issued another. */
export function buildActionTree(
  befores: Map<string, BeforeEvent>,
  afters: Map<string, AfterEvent>,
  commands: CommandLog[],
  indexByCallId: Map<string, number>
): TraceActionChild[] | undefined {
  const groups = buildGroupNodes(befores, afters)
  const rows = new Map<string, TraceActionCommandNode>()
  for (const [callId, commandIndex] of indexByCallId) {
    rows.set(callId, { commandIndex })
  }
  const root: TraceActionChild[] = []
  for (const before of befores.values()) {
    const group = groups.get(before.callId)
    const child: TraceActionChild | undefined = group
      ? { group }
      : rows.get(before.callId)
    if (!child) {
      continue
    }
    // A malformed parent chain that loops back would recurse forever; root it.
    const container = loopsBack(before, befores)
      ? root
      : (containerOf(before, groups, rows) ?? root)
    container.push(child)
  }
  if (groups.size === 0 && ![...rows.values()].some((r) => r.children)) {
    return undefined
  }
  sortTreeChronologically(root, commands)
  for (const child of root) {
    rollupFailed(child, commands)
  }
  return root
}
