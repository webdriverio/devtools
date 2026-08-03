/** HTML boolean content attributes: presence alone is the state, so a captured
 *  "false" has to REMOVE one — written verbatim, `checked="false"` reads as
 *  checked. Curated rather than probed off the element, because a probe both
 *  misses and misfires: `readonly` has no same-named property (it is `readOnly`),
 *  while `draggable`, `spellcheck` and `translate` do carry boolean properties
 *  yet their attributes are enumerated, where "false" is a meaningful value. */
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'disabled',
  'formnovalidate',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected'
])

/** Whether a captured attribute is one whose presence IS its state. `hidden` and
 *  every `aria-*` are absent for the same reason `draggable` is: their "false"
 *  is a real value to write, not an absence to replay. */
export const isBooleanAttribute = (name: string) =>
  BOOLEAN_ATTRIBUTES.has(name.toLowerCase())

/** The only boolean attribute the collector reports as a PROPERTY state rather
 *  than as the attribute's own value: `packages/script` emits `String(el.checked)`
 *  on every input and change, so a cleared checkbox arrives as "false". Every
 *  other boolean attribute reaches the wire only through a real mutation record,
 *  which carries whatever the page set. */
const PROPERTY_STATE_ATTRIBUTES = new Set(['checked'])

/** State a captured boolean attribute carries. A record with no value is off —
 *  there is no attribute state to set. Otherwise presence IS the state, so any
 *  value means on, including `''` (`<input disabled>` reaches the wire empty).
 *
 *  A literal "false" is the one value that depends on which attribute it is:
 *  `checked="false"` is the collector reporting an unchecked box, but
 *  `disabled="false"` can only be the page having SET that attribute, and a
 *  boolean attribute is active whenever present — so it replays as disabled.
 *  The residual ambiguity is a page literally writing `checked="false"`; the
 *  collector's own signal wins there, since it fires on every field edit. */
export const booleanAttributeOn = (name: string, value?: string) => {
  if (value === undefined) {
    return false
  }
  if (!PROPERTY_STATE_ATTRIBUTES.has(name.toLowerCase())) {
    return true
  }
  return value.toLowerCase() !== 'false'
}
