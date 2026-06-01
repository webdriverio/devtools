import { describe, it, expect } from 'vitest'
import { serializeCommandResult } from '../src/helpers/serializeCommandResult.js'

describe('serializeCommandResult', () => {
  describe('null/undefined inputs', () => {
    it('returns undefined for null', () => {
      expect(serializeCommandResult(null, 'click')).toBeUndefined()
    })

    it('returns undefined for undefined', () => {
      expect(serializeCommandResult(undefined, 'click')).toBeUndefined()
    })
  })

  describe('Nightwatch assertion objects {passed, ...}', () => {
    it('collapses to `true` when passed: true', () => {
      const result = serializeCommandResult(
        { passed: true, actual: 'foo', expected: 'foo' },
        'expect'
      )
      expect(result).toBe(true)
    })

    it('returns the structured failure record when passed: false', () => {
      const result = serializeCommandResult(
        {
          passed: false,
          actual: 'foo',
          expected: 'bar',
          message: 'mismatch'
        },
        'expect'
      )
      expect(result).toEqual({
        passed: false,
        actual: 'foo',
        expected: 'bar',
        message: 'mismatch'
      })
    })
  })

  describe('Driver result wrappers {value}', () => {
    it('unwraps the inner value for normal commands', () => {
      expect(serializeCommandResult({ value: 'page title' }, 'getTitle')).toBe(
        'page title'
      )
    })

    it("coerces null to false for boolean-semantic commands (waitFor*, is*, has*)", () => {
      expect(serializeCommandResult({ value: null }, 'waitForExist')).toBe(false)
      expect(serializeCommandResult({ value: null }, 'isVisible')).toBe(false)
      expect(serializeCommandResult({ value: null }, 'hasClass')).toBe(false)
    })

    it('leaves null unchanged for non-boolean commands', () => {
      expect(serializeCommandResult({ value: null }, 'getText')).toBe(null)
    })

    it('preserves an object value verbatim', () => {
      expect(
        serializeCommandResult({ value: { x: 1 } }, 'execute')
      ).toEqual({ x: 1 })
    })
  })

  describe('Plain objects (deep-clone path)', () => {
    it('deep-clones via JSON for plain objects', () => {
      const input = { a: 1, nested: { b: 2 } }
      const out = serializeCommandResult(input, 'execute')
      expect(out).toEqual(input)
      expect(out).not.toBe(input) // not the same reference
    })

    it('falls back to String() for circular references (JSON.stringify throws)', () => {
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular
      const out = serializeCommandResult(circular, 'execute')
      expect(typeof out).toBe('string')
      expect(out).toBe('[object Object]')
    })
  })

  describe('Function inputs', () => {
    it('returns undefined for a function (no useful serialization)', () => {
      expect(
        serializeCommandResult(() => 1, 'execute')
      ).toBeUndefined()
    })
  })
})
