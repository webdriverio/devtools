// Per-scope payload schemas for adapters that cannot import shared (the Python one generates its types from them).

import { realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export type JsonSchema = { [key: string]: unknown }

export interface WireSchema {
  $schema: string
  $comment: string
  scopes: Record<string, JsonSchema>
  $defs: Record<string, JsonSchema>
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHARED_SRC = path.resolve(HERE, '../src')
export const WIRE_SCHEMA_PATH = path.resolve(HERE, '../wire-schema.json')

// A virtual module, so scope names and payloads are read off shared's own maps rather than restated here.
const ENTRY_PATH = path.join(SHARED_SRC, '__wire_schema_entry__.ts')
const ENTRY_SOURCE = `
import type { WsMessageScope, WsPayloadFor } from './ws.js'
import type { TraceExportPayloadFor } from './trace-export.js'
import type { ElementScriptsResponse } from './element-scripts.js'
export type Scopes = { [S in WsMessageScope]: WsPayloadFor<S> } & TraceExportPayloadFor
export type Named = { ElementScriptsResponse: ElementScriptsResponse }
`

class SchemaBuilder {
  readonly defs = new Map<string, JsonSchema>()

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly shared: ts.Symbol
  ) {}

  build(type: ts.Type): JsonSchema {
    const { checker } = this
    const f = type.flags
    if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      return {}
    }
    if (f & ts.TypeFlags.Union) {
      return this.#union((type as ts.UnionType).types)
    }
    if (f & ts.TypeFlags.StringLiteral) {
      return { type: 'string', enum: [(type as ts.StringLiteralType).value] }
    }
    if (f & ts.TypeFlags.NumberLiteral) {
      return { const: (type as ts.NumberLiteralType).value }
    }
    if (f & ts.TypeFlags.BooleanLiteral) {
      return { const: checker.typeToString(type) === 'true' }
    }
    if (f & ts.TypeFlags.String) {
      return { type: 'string' }
    }
    if (f & ts.TypeFlags.Number) {
      return { type: 'number' }
    }
    if (f & ts.TypeFlags.Boolean) {
      return { type: 'boolean' }
    }
    if (f & ts.TypeFlags.Null) {
      return { type: 'null' }
    }
    if (f & ts.TypeFlags.Object) {
      return this.#object(type)
    }
    throw new Error(
      `wire-schema: unsupported type ${checker.typeToString(type)}`
    )
  }

  #union(members: readonly ts.Type[]): JsonSchema {
    const kept = members.filter((m) => !(m.flags & ts.TypeFlags.Undefined))
    const booleans = kept.filter((m) => m.flags & ts.TypeFlags.BooleanLiteral)
    const rest = kept.filter((m) => !(m.flags & ts.TypeFlags.BooleanLiteral))
    const schemas = rest.map((m) => this.build(m))
    if (booleans.length === 2) {
      schemas.push({ type: 'boolean' })
    } else {
      schemas.push(...booleans.map((m) => this.build(m)))
    }
    const literals = schemas.filter(isStringEnum)
    const merged: JsonSchema[] = literals.length
      ? [
          {
            type: 'string',
            enum: literals.flatMap((s) => s.enum as string[])
          },
          ...schemas.filter((s) => !isStringEnum(s))
        ]
      : schemas
    const unique = [
      ...new Map(merged.map((s) => [JSON.stringify(s), s])).values()
    ]
    return unique.length === 1 ? unique[0] : { anyOf: unique }
  }

  #object(type: ts.Type): JsonSchema {
    const { checker } = this
    const name = type.symbol?.name
    // On the wire a Date is its ISO string and an Error its serialized object.
    if (name === 'Date') {
      return { type: 'string', format: 'date-time' }
    }
    if (name === 'Error') {
      return this.#named(
        'SerializedError',
        exportedType(this.checker, this.shared, 'SerializedError')
      )
    }
    if (name === 'Array' || name === 'ReadonlyArray') {
      const [item] = checker.getTypeArguments(type as ts.TypeReference)
      return { type: 'array', items: this.build(item) }
    }
    if (type.symbol && type.symbol.flags & ts.SymbolFlags.Interface) {
      return this.#named(name, type)
    }
    return this.#shape(type)
  }

  #named(name: string, type: ts.Type): JsonSchema {
    if (!this.defs.has(name)) {
      // Registered before it is built, so a self-referencing type terminates.
      this.defs.set(name, {})
      this.defs.set(name, this.#shape(type))
    }
    return { $ref: `#/$defs/${name}` }
  }

  #shape(type: ts.Type): JsonSchema {
    const { checker } = this
    const props = checker.getPropertiesOfType(type)
    const index = checker.getIndexInfosOfType(type)
    if (!props.length && index.length) {
      return {
        type: 'object',
        additionalProperties: this.build(index[0].type)
      }
    }
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const prop of props) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0]
      if (!decl) {
        throw new Error(`wire-schema: no declaration for ${prop.name}`)
      }
      properties[prop.name] = this.build(
        checker.getTypeOfSymbolAtLocation(prop, decl)
      )
      if (!(prop.flags & ts.SymbolFlags.Optional)) {
        required.push(prop.name)
      }
    }
    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  }
}

function isStringEnum(s: JsonSchema): boolean {
  return (
    s.type === 'string' && Array.isArray(s.enum) && Object.keys(s).length === 2
  )
}

function createProgram(): ts.Program {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts'],
    skipLibCheck: true,
    noEmit: true
  }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.fileExists = (f) => f === ENTRY_PATH || fileExists.call(host, f)
  host.readFile = (f) =>
    f === ENTRY_PATH ? ENTRY_SOURCE : readFile.call(host, f)
  host.getSourceFile = (f, lang, ...rest) =>
    f === ENTRY_PATH
      ? ts.createSourceFile(f, ENTRY_SOURCE, lang)
      : getSourceFile.call(host, f, lang, ...rest)
  return ts.createProgram(
    [ENTRY_PATH, path.join(SHARED_SRC, 'index.ts')],
    options,
    host
  )
}

function exportedType(
  checker: ts.TypeChecker,
  module: ts.Symbol,
  name: string
): ts.Type {
  const sym = checker.getExportsOfModule(module).find((s) => s.name === name)
  if (!sym) {
    throw new Error(`wire-schema: ${module.name} does not export ${name}`)
  }
  return checker.getDeclaredTypeOfSymbol(sym)
}

export function buildWireSchema(): WireSchema {
  const program = createProgram()
  const checker = program.getTypeChecker()
  const entry = program.getSourceFile(ENTRY_PATH)
  const index = program.getSourceFile(path.join(SHARED_SRC, 'index.ts'))
  const entryModule = entry && checker.getSymbolAtLocation(entry)
  const shared = index && checker.getSymbolAtLocation(index)
  if (!entry || !entryModule || !shared) {
    throw new Error('wire-schema: could not load shared')
  }
  const builder = new SchemaBuilder(checker, shared)

  const scopes: Record<string, JsonSchema> = {}
  const scopeMap = exportedType(checker, entryModule, 'Scopes')
  for (const prop of checker.getPropertiesOfType(scopeMap)) {
    scopes[prop.name] = builder.build(
      checker.getTypeOfSymbolAtLocation(prop, entry)
    )
  }
  const named = exportedType(checker, entryModule, 'Named')
  for (const prop of checker.getPropertiesOfType(named)) {
    builder.build(checker.getTypeOfSymbolAtLocation(prop, entry))
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment:
      'GENERATED by packages/shared/scripts/wire-schema.ts from shared types. Do not edit.',
    scopes: sortKeys(scopes),
    $defs: sortKeys(Object.fromEntries(builder.defs))
  }
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  )
}

export function formatWireSchema(schema: WireSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

const invoked = process.argv[1] && realpathSync(process.argv[1])
if (invoked === fileURLToPath(import.meta.url)) {
  writeFileSync(WIRE_SCHEMA_PATH, formatWireSchema(buildWireSchema()))
  console.log(`wrote ${path.relative(process.cwd(), WIRE_SCHEMA_PATH)}`)
}
