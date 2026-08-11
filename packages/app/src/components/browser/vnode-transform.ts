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

export function transform(node: TransformInput): VNode<{}> {
  if (typeof node !== 'object' || node === null) {
    // Plain string/number text node — return as-is for Preact to render as text.
    return node as unknown as VNode<{}>
  }

  const { children, ...props } = node.props ?? {}
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
