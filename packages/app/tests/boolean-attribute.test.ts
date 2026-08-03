import { describe, expect, it } from 'vitest'

import {
  booleanAttributeOn,
  isBooleanAttribute
} from '../src/components/browser/boolean-attribute.js'

/**
 * The two pure decisions behind replaying an attribute mutation: whether the
 * attribute's PRESENCE is its state, and — for those that it is — whether the
 * captured record says on or off. The names below are written out literally
 * rather than read back off the set: an expectation derived from the value under
 * test passes whatever that value is.
 */
describe('booleanAttributeOn', () => {
  it('reads a missing value as off, for any attribute', () => {
    // Nothing to set: a record carrying no value leaves no attribute state.
    expect(booleanAttributeOn('checked', undefined)).toBe(false)
    expect(booleanAttributeOn('checked')).toBe(false)
    expect(booleanAttributeOn('disabled', undefined)).toBe(false)
  })

  it('reads an empty value as ON, because empty means present', () => {
    // A real MutationObserver record sends the attribute's own value, so a bare
    // `<input disabled>` reaches the wire with an empty value. Reading the
    // string for truthiness would drop the attribute the page actually had.
    expect(booleanAttributeOn('disabled', '')).toBe(true)
    expect(booleanAttributeOn('checked', '')).toBe(true)
  })

  it('reads the literal string "true" as on', () => {
    expect(booleanAttributeOn('checked', 'true')).toBe(true)
    expect(booleanAttributeOn('disabled', 'true')).toBe(true)
  })

  it('reads any other value as on', () => {
    // Presence is the state, so the value is not a boolean to parse:
    // `checked="checked"` and `disabled="disabled"` are the common spellings.
    expect(booleanAttributeOn('checked', 'checked')).toBe(true)
    expect(booleanAttributeOn('disabled', '0')).toBe(true)
  })

  describe('a literal "false"', () => {
    it('is off for `checked`, the one attribute reported as a property state', () => {
      // The collector emits form-field state as `String(el.checked)` on every
      // input and change, so this is the shape a CLEARED checkbox arrives in —
      // the only boolean attribute for which "false" is a state and not a value.
      expect(booleanAttributeOn('checked', 'false')).toBe(false)
    })

    it("ignores the case `checked`'s state was spelled in", () => {
      expect(booleanAttributeOn('checked', 'False')).toBe(false)
      expect(booleanAttributeOn('checked', 'FALSE')).toBe(false)
    })

    it('is ON for every other boolean attribute, where it is a present value', () => {
      // `disabled="false"` can only have come from the page setting it, and a
      // boolean attribute is active whenever PRESENT — so the captured control
      // was disabled. Removing it would replay it as enabled.
      expect(booleanAttributeOn('disabled', 'false')).toBe(true)
      expect(booleanAttributeOn('readonly', 'false')).toBe(true)
      expect(booleanAttributeOn('required', 'false')).toBe(true)
      expect(booleanAttributeOn('open', 'false')).toBe(true)
    })
  })
})

describe('isBooleanAttribute', () => {
  it('claims an attribute whose presence is its state', () => {
    expect(isBooleanAttribute('disabled')).toBe(true)
    expect(isBooleanAttribute('checked')).toBe(true)
  })

  it('claims an attribute regardless of the case it was captured in', () => {
    expect(isBooleanAttribute('DISABLED')).toBe(true)
    expect(isBooleanAttribute('Checked')).toBe(true)
  })

  it('claims `readonly`, which a property probe off the element would miss', () => {
    // The motivation for curating the set instead of probing the element: the
    // attribute is `readonly`, the property is `readOnly`, so a lookup keyed on
    // the captured attribute name finds nothing and the attribute would be
    // written verbatim — `readonly="false"` makes the field read-only.
    expect(isBooleanAttribute('readonly')).toBe(true)
    // Keyed on the attribute spelling, matched case-insensitively, so the
    // property's spelling resolves to the same entry rather than a second one.
    expect(isBooleanAttribute('readOnly')).toBe(true)
  })

  it('disclaims `hidden`, an enumerated attribute whose "false" is a value', () => {
    expect(isBooleanAttribute('hidden')).toBe(false)
  })

  it('disclaims `aria-*` state, where "false" is the state and not an absence', () => {
    expect(isBooleanAttribute('aria-checked')).toBe(false)
    expect(isBooleanAttribute('aria-disabled')).toBe(false)
    expect(isBooleanAttribute('aria-hidden')).toBe(false)
  })

  it('disclaims the enumerated attributes that do carry boolean properties', () => {
    // `draggable`, `spellcheck` and `translate` are why the set cannot be built
    // by probing for a same-named boolean property: they have one, yet their
    // attributes are enumerated and "false" is meaningful — deleting it would
    // replay a draggable element as the default the page overrode.
    expect(isBooleanAttribute('draggable')).toBe(false)
    expect(isBooleanAttribute('spellcheck')).toBe(false)
    expect(isBooleanAttribute('translate')).toBe(false)
  })

  it('disclaims a plain value attribute', () => {
    expect(isBooleanAttribute('value')).toBe(false)
    expect(isBooleanAttribute('class')).toBe(false)
  })
})
