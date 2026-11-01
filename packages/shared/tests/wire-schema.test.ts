import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildWireSchema,
  formatWireSchema,
  WIRE_SCHEMA_PATH,
  type WireSchema
} from '../scripts/wire-schema.js'

let schema: WireSchema

beforeAll(() => {
  schema = buildWireSchema()
}, 30_000)

describe('wire schema', () => {
  it('the committed copy matches shared types', () => {
    expect(
      readFileSync(WIRE_SCHEMA_PATH, 'utf8'),
      'stale: run `pnpm --filter @wdio/devtools-shared gen:wire-schema`'
    ).toBe(formatWireSchema(schema))
  })

  it('keys every payload-typed scope, including the trace-export pair', () => {
    expect(Object.keys(schema.scopes)).toEqual(
      expect.arrayContaining([
        'commands',
        'metadata',
        'replaceCommand',
        'suites',
        'traceExport',
        'traceExported'
      ])
    )
    expect(schema.scopes.commands).toEqual({
      type: 'array',
      items: { $ref: '#/$defs/CommandLog' }
    })
  })

  it('describes a Date as the ISO string it serializes to', () => {
    const props = (schema.$defs.TestStats.properties ?? {}) as Record<
      string,
      unknown
    >
    expect(props.start).toEqual({ type: 'string', format: 'date-time' })
    expect(props.end).toEqual({
      anyOf: [{ type: 'null' }, { type: 'string', format: 'date-time' }]
    })
  })

  it('collapses Error | SerializedError onto SerializedError', () => {
    const props = schema.$defs.CommandLog.properties as Record<string, unknown>
    expect(props.error).toEqual({ $ref: '#/$defs/SerializedError' })
  })

  it('requires only non-optional fields, and forbids unknown ones', () => {
    const log = schema.$defs.ConsoleLog
    expect(log.required).toEqual(['type', 'args', 'timestamp'])
    expect(log.additionalProperties).toBe(false)
  })

  it('reduces enums and literal unions to a string enum', () => {
    const meta = schema.$defs.Metadata.properties as Record<string, unknown>
    expect(meta.type).toEqual({
      type: 'string',
      enum: ['standalone', 'testrunner']
    })
  })

  it('maps a Record to additionalProperties', () => {
    expect(schema.scopes.sources).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' }
    })
  })
})
