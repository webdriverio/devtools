// Converts a serialized VNode (captured by the injected script) into a Preact
// VNode the snapshot iframe can render. Pure — no DOM or component state.

import { type VNode, h } from 'preact'

import { booleanAttributeOn, isBooleanAttribute } from './boolean-attribute.js'

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

/**
 * A boolean attribute's state is its PRESENCE, and the anchor captures markup —
 * so a page's own `<input type="checkbox" checked>` arrives as `checked=""`.
 * Preact assigns these as properties (`name in dom`), where `''` is falsy, so
 * the box replayed unchecked while the screencast showed it ticked; `disabled`,
 * `readonly`, `selected` and the rest replayed off the same way, rendering a
 * disabled control as usable. Measured: `checked=""` → property `false`.
 *
 * Resolved through the helpers the mutation path already uses, so one policy
 * decides both routes into the replayed DOM.
 */
function withBooleanAttributeState(
  props: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    resolved[key] =
      typeof value === 'string' && isBooleanAttribute(key)
        ? booleanAttributeOn(key, value)
        : value
  }
  return resolved
}

export function transform(node: TransformInput): VNode<{}> {
  if (typeof node !== 'object' || node === null) {
    // Plain string/number text node — return as-is for Preact to render as text.
    return node as unknown as VNode<{}>
  }

  const { children, ...rawProps } = node.props ?? {}
  const props = withBooleanAttributeState(withoutInlineHandlers(rawProps))
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
