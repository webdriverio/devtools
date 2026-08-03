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

/** State a captured boolean attribute carries. The collector emits form-field
 *  state as `String(el.checked)` and every other record as the attribute's own
 *  value, so only a literal "false" — and a record carrying no value, which
 *  leaves no attribute state to set — means off: an empty value is a present
 *  attribute (`<input disabled>` reaches the wire as `''`). */
export const booleanAttributeOn = (value?: string) =>
  value !== undefined && value.toLowerCase() !== 'false'
