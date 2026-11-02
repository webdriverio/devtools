// Converts a serialized VNode (captured by the injected script) into a Preact
// VNode the snapshot iframe can render. Pure — no DOM or component state.

import { type VNode, h } from 'preact'

import { isBooleanAttribute } from './boolean-attribute.js'
import {
  isUnsafeReplayAttribute,
  isUnsafeReplayElement
} from './replay-safety.js'

interface SerializedVNode {
  type?: string
  props?: {
    children?: SerializedVNode | SerializedVNode[] | string | number
  } & Record<string, unknown>
}

type TransformInput = SerializedVNode | string | number | null

/**
 * Inline event attributes (`<button onclick="…">`) are captured as STRINGS, and
 * Preact reads any `on*` prop as a listener: it stamps its own bookkeeping
 * property onto the value, which throws `Cannot create property … on string`
 * and aborts the whole render. One such attribute anywhere in the document was
 * enough to leave the replay iframe blank with nothing logged.
 *
 * They, and every other attribute that could run script, are dropped: the
 * replay is a static reconstruction of an untrusted trace. A function value
 * (never produced by capture) is left alone so a real listener still binds.
 */
function withoutUnsafeAttributes(
  props: Record<string, unknown>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' || !isUnsafeReplayAttribute(key, value)) {
      kept[key] = value
    }
  }
  return kept
}

/**
 * A boolean attribute's state is its PRESENCE, and everything reaching here is
 * MARKUP — the anchor and every added node are serialized with `outerHTML` —
 * so a page's own `<input type="checkbox" checked>` arrives as `checked=""`.
 * Preact assigns these as properties (`name in dom`), where `''` is falsy, so
 * the box replayed unchecked while the screencast showed it ticked; `disabled`,
 * `readonly`, `selected` and the rest replayed off the same way, rendering a
 * disabled control as usable. Measured: `checked=""` → property `false`.
 *
 * Presence alone, never the value: `checked="false"` in markup is a CHECKED box
 * (the browser reads the attribute, not what it says), so this deliberately
 * does NOT share `booleanAttributeOn` with the mutation path. There "false" is
 * the collector reporting a cleared field — a signal that only exists on that
 * path, since `#handleAttributeMutation` is where those records land and they
 * never come through here.
 */
function withBooleanAttributeState(
  props: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    resolved[key] = isBooleanAttribute(key) ? true : value
  }
  return resolved
}

export function transform(node: TransformInput): VNode<{}> {
  if (typeof node !== 'object' || node === null) {
    // Plain string/number text node — return as-is for Preact to render as text.
    return node as unknown as VNode<{}>
  }

  // Every replayed node passes here, an added one included; Preact renders a null child as nothing.
  if (isUnsafeReplayElement(node.type)) {
    return null as unknown as VNode<{}>
  }
  const { children, ...rawProps } = node.props ?? {}
  const props = withBooleanAttributeState(withoutUnsafeAttributes(rawProps))
  /**
   * ToDo(Christian): fix way we collect data on added nodes in script
   */
  if (
    !node.type &&
    children &&
    typeof children === 'object' &&
    !Array.isArray(children) &&
    children.type
  ) {
    return transform(children)
  }

  const childrenRequired = children || []
  const c = Array.isArray(childrenRequired)
    ? childrenRequired
    : [childrenRequired]
  return h(node.type as string, props, ...c.map(transform)) as VNode<{}>
}
