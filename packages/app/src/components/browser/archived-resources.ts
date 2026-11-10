// A loaded trace's stored stylesheets and fonts, served to the replayed page as blob URLs.

import { rewriteCssUrls } from '@wdio/devtools-shared'

import { BROWSER_BLOB_URLS, type BlobUrls } from '../../utils/blob-urls.js'

/** Rewrites the URLs of one replayed document, resolved against its own URL. */
export interface ResourceRewriter {
  /** A `<link href>`'s archived blob URL, or undefined to keep the live one. */
  href(url: string): string | undefined
  /** CSS text with archived references pointing at their blobs. */
  css(text: string): string
}

/** A stored resource read out of the trace: a stylesheet as text, since it is rewritten before use, a font as it is. */
export type StoredPageResource = { url: string; mimeType: string } & (
  { kind: 'stylesheet'; text: string } | { kind: 'font'; blob: Blob }
)

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
function fontType(mimeType: string): string {
  return FONT_TYPE.test(mimeType) ? mimeType : 'application/octet-stream'
}

export class ArchivedResources {
  readonly #blobs: BlobUrls
  #byUrl = new Map<string, StoredPageResource>()
  #blobUrls = new Map<string, string>()
  /** Stylesheets mid-rewrite, so an `@import` cycle ends at the live URL. */
  #resolving = new Set<string>()

  constructor(blobs: BlobUrls = BROWSER_BLOB_URLS) {
    this.#blobs = blobs
  }

  /** Replaces the loaded trace's resources, revoking the previous trace's blobs. */
  load(resources: readonly StoredPageResource[]): void {
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
      const blob =
        resource.kind === 'stylesheet'
          ? new Blob([this.#rewrite(resource.text, url)], { type: 'text/css' })
          : new Blob([resource.blob], { type: fontType(resource.mimeType) })
      const blobUrl = this.#blobs.create(blob)
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
