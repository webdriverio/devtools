// `TraceMutation` here is the browser-side global (packages/script/types.d.ts),
// not shared's Node-safe twin: its `addedNodes: (string | SimplifiedVNode)[]`
// narrows shared's `unknown[]`, so a value typed as the global satisfies both
// the components that use the global and those importing from shared — the
// reverse assignment does not compile.

import type { CommandLog } from '@wdio/devtools-shared'
import type { SimplifiedVNode } from '../../../script/types'

/** Fixed base so builder output is stable across runs and across builders. */
const BASE_TIMESTAMP = 1000

export function commandLog(overrides: Partial<CommandLog> = {}): CommandLog {
  return {
    command: 'click',
    args: ['#submit'],
    timestamp: BASE_TIMESTAMP,
    ...overrides
  }
}

export function mutation(
  overrides: Partial<TraceMutation> = {}
): TraceMutation {
  return {
    type: 'attributes',
    target: 'wdio-ref-1',
    attributeName: 'class',
    attributeValue: 'active',
    addedNodes: [],
    removedNodes: [],
    timestamp: BASE_TIMESTAMP,
    ...overrides
  }
}

/** `target` is deliberately absent: the app reads a childList mutation as a
 *  document load from exactly one added node plus a `url`, and the snapshot
 *  player additionally requires no `target` to treat it as the new root. */
export function documentLoaded(
  url: string,
  overrides: Partial<TraceMutation> = {}
): TraceMutation {
  const root: SimplifiedVNode = { type: 'html', props: {} }
  return {
    type: 'childList',
    addedNodes: [root],
    removedNodes: [],
    url,
    timestamp: BASE_TIMESTAMP,
    ...overrides
  }
}
