// The stored stylesheets and fonts an archive keeps: what its DOM stream uses, under `resources/<sha1>`, and their index.

import {
  cssUrlReferences,
  documentBaseUrl,
  PAGE_RESOURCE_LIMITS,
  type PageResource,
  type PageResourceIndexEntry,
  type TraceMutation
} from '@wdio/devtools-shared'
import { sha1Hex } from './sha1.js'
import type { TraceZipResource } from './trace-zip-writer.js'

interface VNodeLike {
  type?: string
  props?: Record<string, unknown> & { children?: unknown }
}

/** A link that loads a stylesheet or a font: `stylesheet`, or a preload of one. */
const LINKED_RELS = ['stylesheet', 'preload', 'prefetch']

function resolveUrl(url: string, base: string | undefined): string | undefined {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    return undefined
  }
  try {
    const resolved = new URL(url, base)
    resolved.hash = ''
    return resolved.href
  } catch {
    return undefined
  }
}

function asVNode(node: unknown): VNodeLike | undefined {
  return typeof node === 'object' && node !== null
    ? (node as VNodeLike)
    : undefined
}

function childrenOf(node: VNodeLike): unknown[] {
  const children = node.props?.children
  if (children === undefined || children === null) {
    return []
  }
  return Array.isArray(children) ? children : [children]
}

function textOf(node: VNodeLike): string {
  return childrenOf(node)
    .filter((child): child is string => typeof child === 'string')
    .join('')
}

/** Collects the URLs a DOM stream references, each resolved against its document. */
class ReferenceCollector {
  readonly urls = new Set<string>()

  addCss(css: string, base: string | undefined): void {
    for (const ref of cssUrlReferences(css)) {
      this.addUrl(ref.url, base)
    }
  }

  addUrl(url: string, base: string | undefined): void {
    const resolved = resolveUrl(url, base)
    if (resolved) {
      this.urls.add(resolved)
    }
  }

  walk(root: unknown, base: string | undefined): void {
    const stack: unknown[] = [root]
    while (stack.length > 0) {
      const node = asVNode(stack.pop())
      if (!node) {
        continue
      }
      this.#visit(node, base)
      // Pushed last-first, so the stack visits children in document order.
      const children = childrenOf(node)
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i])
      }
    }
  }

  #visit(node: VNodeLike, base: string | undefined): void {
    const props = node.props ?? {}
    if (typeof props.style === 'string') {
      this.addCss(props.style, base)
    }
    if (node.type === 'style') {
      this.addCss(textOf(node), base)
    }
    if (node.type === 'link' && typeof props.href === 'string') {
      const rel = String(props.rel ?? '').toLowerCase()
      if (LINKED_RELS.some((r) => rel.split(/\s+/).includes(r))) {
        this.addUrl(props.href, base)
      }
    }
  }
}

/** Every stored URL the DOM stream references, directly or through a stored stylesheet. */
export function referencedResourceUrls(
  mutations: readonly TraceMutation[],
  stored: ReadonlyMap<string, PageResource>
): string[] {
  if (stored.size === 0) {
    return []
  }
  const refs = new ReferenceCollector()
  // The current document's base: its own `<base href>`, as the player resolves it too.
  let base: string | undefined
  for (const mutation of mutations) {
    if (mutation.url !== undefined) {
      base = documentBaseUrl(mutation.addedNodes[0], mutation.url)
    }
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        refs.walk(node, base)
      }
    } else if (mutation.type === 'attributes') {
      if (mutation.attributeName === 'style' && mutation.attributeValue) {
        refs.addCss(mutation.attributeValue, base)
      } else if (mutation.attributeName === 'href' && mutation.attributeValue) {
        refs.addUrl(mutation.attributeValue, base)
      }
    } else if (mutation.newTextContent) {
      refs.addCss(mutation.newTextContent, base)
    }
  }
  return closeOverStylesheets(refs.urls, stored)
}

/** The stored URLs among `direct`, plus what their stylesheets load in turn. */
function closeOverStylesheets(
  direct: ReadonlySet<string>,
  stored: ReadonlyMap<string, PageResource>
): string[] {
  const selected: string[] = []
  const seen = new Set<string>()
  const queue = [...direct]
  while (queue.length > 0) {
    const url = queue.shift()!
    const resource = stored.get(url)
    if (!resource || seen.has(url)) {
      continue
    }
    seen.add(url)
    selected.push(url)
    if (resource.kind !== 'stylesheet') {
      continue
    }
    const css = Buffer.from(resource.data, 'base64').toString('utf8')
    for (const ref of cssUrlReferences(css)) {
      const dependency = resolveUrl(ref.url, url)
      if (dependency && !seen.has(dependency)) {
        queue.push(dependency)
      }
    }
  }
  return selected
}

export interface PageResourceCaps {
  maxTraceBytes: number
}

export interface PageResourceEntries {
  resources: TraceZipResource[]
  /** `page-resources.ndjson`; empty when nothing is stored. */
  indexNdjson: Buffer
}

/** The stored resources this archive's DOM stream uses, each body once by content hash; a per-test slice gets the whole run's and keeps its own. */
export function buildPageResourceEntries(
  resources: readonly PageResource[] | undefined,
  mutations: readonly TraceMutation[],
  caps: PageResourceCaps = { maxTraceBytes: PAGE_RESOURCE_LIMITS.maxTraceBytes }
): PageResourceEntries {
  const stored = new Map<string, PageResource>()
  for (const resource of resources ?? []) {
    if (!stored.has(resource.url)) {
      stored.set(resource.url, resource)
    }
  }
  const out: TraceZipResource[] = []
  const index: PageResourceIndexEntry[] = []
  const written = new Set<string>()
  let total = 0
  for (const url of referencedResourceUrls(mutations, stored)) {
    const resource = stored.get(url)!
    const data = Buffer.from(resource.data, 'base64')
    const sha1 = sha1Hex(data)
    if (!written.has(sha1)) {
      // Past the archive's cap a resource replays from the live site, as before.
      if (total + data.byteLength > caps.maxTraceBytes) {
        continue
      }
      written.add(sha1)
      total += data.byteLength
      out.push({ resourceName: sha1, data })
    }
    index.push({
      url,
      sha1,
      mimeType: resource.mimeType,
      kind: resource.kind,
      size: data.byteLength
    })
  }
  return {
    resources: out,
    indexNdjson: Buffer.from(
      index.map((entry) => JSON.stringify(entry)).join('\n'),
      'utf8'
    )
  }
}
