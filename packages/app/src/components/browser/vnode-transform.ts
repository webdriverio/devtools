// Converts a serialized VNode (captured by the injected script) into a Preact
// VNode the snapshot iframe can render. Pure — no DOM or component state.

import { type VNode, h } from 'preact'

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
 * enough to leave the replay iframe blank with nothing logged — the render
 * never reached an `<html>` element, so the caller's own guard returned early.
 *
 * Dropping them costs nothing: the replay is a static reconstruction and
 * `#renderVdom` strips `<script>` tags for the same reason, so a handler has
 * nothing left to fire. A function value (never produced by capture) is left
 * alone so a real listener still binds.
 */
function withoutInlineHandlers(
  props: Record<string, unknown>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!(/^on[A-Za-z]/.test(key) && typeof value === 'string')) {
      kept[key] = value
    }
  }
  return kept
}

export function transform(node: TransformInput): VNode<{}> {
  if (typeof node !== 'object' || node === null) {
    // Plain string/number text node — return as-is for Preact to render as text.
    return node as unknown as VNode<{}>
  }

  const { children, ...rawProps } = node.props ?? {}
  const props = withoutInlineHandlers(rawProps)
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
