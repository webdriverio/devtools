// Rebuilds the collapsible action tree from the structural before events that
// buildCommands drops from the flat list: foreign runner steps (self-referencing
// stepId, nested via parentId) and our Tracing.tracingGroup markers (children
// linked via parentId). Library-call leaves attach to the group their stepId
// points at; unreferenced commands surface at the root in chronological order.

import type {
  CommandLog,
  TraceActionChild,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

import type { AfterEvent, BeforeEvent } from './trace-reader-types.js'

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
    if (before.parentId) {
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

function sortTreeChronologically(
  children: TraceActionChild[],
  commands: CommandLog[]
): void {
  children.sort(
    (a, b) => childStartTime(a, commands) - childStartTime(b, commands)
  )
  for (const child of children) {
    if ('group' in child) {
      sortTreeChronologically(child.group.children, commands)
    }
  }
}

// Post-order rollup: a group fails when its own after errored or any
// descendant group/command did.
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

/** Build the action tree, or undefined when the zip has no structural steps. */
export function buildActionTree(
  befores: Map<string, BeforeEvent>,
  afters: Map<string, AfterEvent>,
  commands: CommandLog[],
  indexByCallId: Map<string, number>
): TraceActionChild[] | undefined {
  const nodes = buildGroupNodes(befores, afters)
  if (nodes.size === 0) {
    return undefined
  }
  const root: TraceActionChild[] = []
  for (const before of befores.values()) {
    const node = nodes.get(before.callId)
    const commandIndex = indexByCallId.get(before.callId)
    let child: TraceActionChild
    if (node) {
      child = { group: node }
    } else if (commandIndex !== undefined) {
      child = { commandIndex }
    } else {
      continue
    }
    const parent = parentGroupOf(before, nodes)
    // A malformed self-parent would recurse forever in the rollup; root it.
    if (parent && parent !== node) {
      parent.children.push(child)
    } else {
      root.push(child)
    }
  }
  sortTreeChronologically(root, commands)
  for (const child of root) {
    rollupFailed(child, commands)
  }
  return root
}
