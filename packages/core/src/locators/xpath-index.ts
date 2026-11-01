import type { Element as XMLElement } from '@xmldom/xmldom'

import type { XMLDocument, XMLNode } from './types.js'

/** A page source's elements by tag and attribute value, built once per walk. */
interface XPathIndex {
  doc: XMLDocument
  all: XMLElement[]
  byTag: Map<string, XMLElement[]>
  byAttr: Map<string, Map<string, XMLElement[]>>
}

interface Condition {
  name: string
  value: string
}

interface ParsedQuery {
  tag: string
  conditions: Condition[]
}

const NAME = /[A-Za-z_][\w.-]*/y

/** The index for the walk in progress; scoped so a document edited later is never answered from it. */
let active: XPathIndex | null = null

/** `//*` or `//Tag`, optionally `[@a="x" and @b='y']`; null for anything else. */
export function parseSimpleXPath(expr: string): ParsedQuery | null {
  if (!expr.startsWith('//')) {
    return null
  }
  let pos = 2
  let tag: string
  if (expr[pos] === '*') {
    tag = '*'
    pos++
  } else {
    NAME.lastIndex = pos
    const m = NAME.exec(expr)
    if (!m) {
      return null
    }
    tag = m[0]
    pos = NAME.lastIndex
  }
  if (pos === expr.length) {
    return { tag, conditions: [] }
  }
  if (expr[pos] !== '[' || !expr.endsWith(']')) {
    return null
  }
  const conditions = parseConditions(expr.slice(pos + 1, -1))
  return conditions ? { tag, conditions } : null
}

function parseConditions(body: string): Condition[] | null {
  const conditions: Condition[] = []
  let pos = 0
  for (;;) {
    if (body[pos] !== '@') {
      return null
    }
    NAME.lastIndex = pos + 1
    const m = NAME.exec(body)
    if (!m || body[NAME.lastIndex] !== '=') {
      return null
    }
    const quote = body[NAME.lastIndex + 1]
    if (quote !== '"' && quote !== "'") {
      return null
    }
    const start = NAME.lastIndex + 2
    const end = body.indexOf(quote, start)
    if (end === -1) {
      return null
    }
    conditions.push({ name: m[0], value: body.slice(start, end) })
    pos = end + 1
    if (pos === body.length) {
      return conditions
    }
    if (!body.startsWith(' and ', pos)) {
      return null
    }
    pos += 5
  }
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    list.push(value)
  } else {
    map.set(key, [value])
  }
}

/** Null for a namespaced document: XPath name tests resolve namespaces, the index does not. */
function buildIndex(doc: XMLDocument): XPathIndex | null {
  const index: XPathIndex = {
    doc,
    all: [],
    byTag: new Map(),
    byAttr: new Map()
  }
  const stack: XMLElement[] = doc.documentElement ? [doc.documentElement] : []
  const ordered: XMLElement[] = []
  while (stack.length > 0) {
    const el = stack.pop()!
    if (el.namespaceURI || el.nodeName.includes(':')) {
      return null
    }
    ordered.push(el)
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const child = el.childNodes.item(i)
      if (child?.nodeType === 1) {
        stack.push(child as XMLElement)
      }
    }
  }
  for (const el of ordered) {
    index.all.push(el)
    append(index.byTag, el.nodeName, el)
    for (let i = 0; i < el.attributes.length; i++) {
      const { name, value } = el.attributes.item(i)!
      if (name === 'xmlns' || name.includes(':')) {
        return null
      }
      let byValue = index.byAttr.get(name)
      if (!byValue) {
        byValue = new Map()
        index.byAttr.set(name, byValue)
      }
      append(byValue, value, el)
    }
  }
  return index
}

/** Runs `walk` with `doc` indexed, so simple uniqueness checks are lookups instead of full scans. */
export function withXPathIndex<T>(doc: XMLDocument | null, walk: () => T): T {
  const previous = active
  active = doc ? buildIndex(doc) : null
  try {
    return walk()
  } finally {
    active = previous
  }
}

/** The nodes a simple XPath selects, in document order; null when the index cannot answer. */
export function selectIndexed(
  doc: XMLDocument,
  expr: string
): XMLNode[] | null {
  if (active?.doc !== doc) {
    return null
  }
  const query = parseSimpleXPath(expr)
  if (!query) {
    return null
  }
  const [first, ...rest] = query.conditions
  const candidates = first
    ? (active.byAttr.get(first.name)?.get(first.value) ?? [])
    : query.tag === '*'
      ? active.all
      : (active.byTag.get(query.tag) ?? [])
  return candidates.filter(
    (el) =>
      (query.tag === '*' || el.nodeName === query.tag) &&
      rest.every(
        (c) => el.hasAttribute(c.name) && el.getAttribute(c.name) === c.value
      )
  )
}
