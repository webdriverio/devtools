// A loaded trace's stored stylesheets and fonts, served to the replayed page as blob URLs.

import { rewriteCssUrls, type PageResource } from '@wdio/devtools-shared'

/** Rewrites the URLs of one replayed document, resolved against its own URL. */
export interface ResourceRewriter {
  /** A `<link href>`'s archived blob URL, or undefined to keep the live one. */
  href(url: string): string | undefined
  /** CSS text with archived references pointing at their blobs. */
  css(text: string): string
}

interface BlobApi {
  create(blob: Blob): string
  revoke(url: string): void
}

const BROWSER_BLOBS: BlobApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url)
}

/** The absolute URL a reference names, or undefined for one that loads nothing (inline data, an in-document `#id`). */
function absolute(url: string, base: string): string | undefined {
  const trimmed = url.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return undefined
  }
  try {
    const resolved = new URL(trimmed, base)
    resolved.hash = ''
    return resolved.href
  } catch {
    return undefined
  }
}

const FONT_TYPE = /^(font\/|application\/(font-|x-font-|vnd\.ms-fontobject))/i

/** The blob's type from its kind, never from the trace alone: a crafted trace must not make a blob a document. */
function blobType(resource: PageResource): string {
  if (resource.kind === 'stylesheet') {
    return 'text/css'
  }
  return FONT_TYPE.test(resource.mimeType)
    ? resource.mimeType
    : 'application/octet-stream'
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export class ArchivedResources {
  readonly #blobs: BlobApi
  #byUrl = new Map<string, PageResource>()
  #blobUrls = new Map<string, string>()
  /** Stylesheets mid-rewrite, so an `@import` cycle ends at the live URL. */
  #resolving = new Set<string>()

  constructor(blobs: BlobApi = BROWSER_BLOBS) {
    this.#blobs = blobs
  }

  /** Replaces the loaded trace's resources, revoking the previous trace's blobs. */
  load(resources: readonly PageResource[]): void {
    this.clear()
    for (const resource of resources) {
      this.#byUrl.set(resource.url, resource)
    }
  }

  clear(): void {
    for (const url of this.#blobUrls.values()) {
      this.#blobs.revoke(url)
    }
    this.#blobUrls.clear()
    this.#byUrl.clear()
  }

  /** A stored URL's blob URL, built on first use, a stylesheet's dependencies before it. */
  urlFor(url: string): string | undefined {
    const existing = this.#blobUrls.get(url)
    if (existing) {
      return existing
    }
    const resource = this.#byUrl.get(url)
    if (!resource || this.#resolving.has(url)) {
      return undefined
    }
    this.#resolving.add(url)
    try {
      const bytes = decodeBase64(resource.data)
      const body =
        resource.kind === 'stylesheet'
          ? this.#rewrite(new TextDecoder().decode(bytes), url)
          : bytes
      const blobUrl = this.#blobs.create(
        new Blob([body], { type: blobType(resource) })
      )
      this.#blobUrls.set(url, blobUrl)
      return blobUrl
    } catch (err) {
      console.warn(
        `Stored copy of ${url} is unreadable; replaying it live.`,
        err
      )
      return undefined
    } finally {
      this.#resolving.delete(url)
    }
  }

  /** The rewriter for a document at `baseUrl`; undefined when the trace stored nothing, so replay is untouched. */
  rewriterFor(baseUrl: string): ResourceRewriter | undefined {
    if (this.#byUrl.size === 0) {
      return undefined
    }
    return {
      href: (url) => {
        const resolved = absolute(url, baseUrl)
        return resolved ? this.urlFor(resolved) : undefined
      },
      css: (text) => this.#rewrite(text, baseUrl)
    }
  }

  /** The rewriter for the replayed document `node` sits in, resolved against its `<base href>`. */
  rewriterForNode(node: Node): ResourceRewriter | undefined {
    const base = node.ownerDocument?.baseURI
    return base ? this.rewriterFor(base) : undefined
  }

  /** An attribute a mutation sets, pointed at the stored copies: a style attribute's CSS, a stylesheet link's href. */
  attributeValue(el: Element, name: string, value: string): string {
    const isLinkHref = name === 'href' && el.tagName === 'LINK'
    const rewrite =
      name === 'style' || isLinkHref ? this.rewriterForNode(el) : undefined
    if (!rewrite) {
      return value
    }
    return isLinkHref ? (rewrite.href(value) ?? value) : rewrite.css(value)
  }

  /** Text a mutation sets inside `parent`, rewritten when the parent is a `<style>`. */
  textValue(parent: Element, text: string): string {
    const rewrite =
      parent.tagName === 'STYLE' ? this.rewriterForNode(parent) : undefined
    return rewrite ? rewrite.css(text) : text
  }

  /** Stored references become blobs; any other becomes absolute, since a blob stylesheet has no base of its own to resolve it against. */
  #rewrite(css: string, baseUrl: string): string {
    return rewriteCssUrls(css, (ref) => {
      const resolved = absolute(ref.url, baseUrl)
      return resolved ? (this.urlFor(resolved) ?? resolved) : undefined
    })
  }
}

/** The loaded trace's resources; the data manager loads them with each trace. */
export const archivedResources = new ArchivedResources()
