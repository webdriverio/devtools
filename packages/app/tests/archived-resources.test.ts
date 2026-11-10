/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import type { PageResourceKind } from '@wdio/devtools-shared'

import { render } from 'preact'
import {
  ArchivedResources,
  type StoredPageResource
} from '../src/components/browser/archived-resources.js'
import { replayDocument } from '../src/components/browser/vnode-transform.js'

function resource(
  url: string,
  body: string,
  kind: PageResourceKind = 'stylesheet',
  mimeType = kind === 'stylesheet' ? 'text/css' : 'font/woff2'
): StoredPageResource {
  return kind === 'stylesheet'
    ? { url, kind, mimeType, text: body }
    : { url, kind, mimeType, blob: new Blob([body]) }
}

/** Records every blob it is handed, in order, under a readable name. */
function fakeBlobs() {
  const made: { url: string; blob: Blob }[] = []
  const revoked: string[] = []
  return {
    made,
    revoked,
    api: {
      create: (blob: Blob) => {
        const url = `blob:test/${made.length}`
        made.push({ url, blob })
        return url
      },
      revoke: (url: string) => void revoked.push(url)
    }
  }
}

const SITE = 'https://site.test/css/site.css'
const FONT = 'https://site.test/fonts/icons.woff2'
const PART = 'https://site.test/css/part.css'

describe('ArchivedResources', () => {
  it('rewrites a stored stylesheet against its own URL: stored references to blobs, the rest absolute', async () => {
    const blobs = fakeBlobs()
    const archive = new ArchivedResources(blobs.api)
    archive.load([
      resource(
        SITE,
        '@import "part.css"; @font-face { src: url(../fonts/icons.woff2) } .a { background: url(img/bg.png) } .b { filter: url(#f) } .c { background: url(data:image/png;base64,AA==) }'
      ),
      resource(PART, 'p{}'),
      resource(FONT, 'wOF2', 'font')
    ])

    const url = archive.urlFor(SITE)!
    const site = blobs.made.find((b) => b.url === url)!
    const text = await site.blob.text()

    expect(site.blob.type).toBe('text/css')
    // Dependencies first, so the stylesheet can name their blobs.
    expect(blobs.made.map((b) => b.url).indexOf(url)).toBe(2)
    expect(text).toContain('@import "blob:test/0"')
    expect(text).toContain('url("blob:test/1")')
    expect(text).toContain('url("https://site.test/css/img/bg.png")')
    expect(text).toContain('url(#f)')
    expect(text).toContain('url(data:image/png;base64,AA==)')
  })

  it('ends an @import cycle at the live URL instead of recursing', async () => {
    const blobs = fakeBlobs()
    const archive = new ArchivedResources(blobs.api)
    archive.load([
      resource(SITE, '@import "part.css";'),
      resource(PART, '@import "site.css";')
    ])

    archive.urlFor(SITE)
    const part = await blobs.made[0].blob.text()
    expect(part).toBe(`@import "${SITE}";`)
    expect(blobs.made).toHaveLength(2)
  })

  it('builds each blob once and revokes them when another trace loads', () => {
    const blobs = fakeBlobs()
    const archive = new ArchivedResources(blobs.api)
    archive.load([resource(FONT, 'wOF2', 'font')])

    expect(archive.urlFor(FONT)).toBe(archive.urlFor(FONT))
    archive.load([])
    expect(blobs.revoked).toEqual(['blob:test/0'])
    expect(archive.urlFor(FONT)).toBeUndefined()
  })

  it('leaves replay untouched for a trace that stored nothing', () => {
    expect(new ArchivedResources(fakeBlobs().api).rewriterFor(SITE)).toBe(
      undefined
    )
  })

  it('resolves a link and inline CSS against the document URL', () => {
    const archive = new ArchivedResources(fakeBlobs().api)
    archive.load([resource(SITE, 'p{}'), resource(FONT, 'wOF2', 'font')])
    const rewrite = archive.rewriterFor('https://site.test/login')!

    expect(rewrite.href('css/site.css')).toBe('blob:test/0')
    expect(rewrite.href('/other.css')).toBeUndefined()
    expect(rewrite.css('@font-face{src:url("/fonts/icons.woff2")}')).toBe(
      '@font-face{src:url("blob:test/1")}'
    )
  })

  it('never hands a crafted type to a blob', () => {
    const blobs = fakeBlobs()
    const archive = new ArchivedResources(blobs.api)
    archive.load([
      resource(SITE, 'p{}', 'stylesheet', 'text/html'),
      resource(FONT, 'x', 'font', 'text/html')
    ])
    archive.urlFor(SITE)
    archive.urlFor(FONT)
    expect(blobs.made.map((b) => b.blob.type)).toEqual([
      'text/css',
      'application/octet-stream'
    ])
  })

  it('replays a stored copy it cannot make a URL for live', () => {
    const archive = new ArchivedResources({
      create: () => {
        throw new Error('quota')
      },
      revoke: () => {}
    })
    archive.load([resource(FONT, 'x', 'font')])
    expect(archive.urlFor(FONT)).toBeUndefined()
  })

  it('rewrites a mutation\u2019s style attribute, stylesheet href and <style> text, and nothing else', () => {
    const archive = new ArchivedResources(fakeBlobs().api)
    archive.load([resource(SITE, 'p{}'), resource(FONT, 'wOF2', 'font')])
    const doc = document.implementation.createHTMLDocument('replay')
    const base = doc.createElement('base')
    base.href = 'https://site.test/login'
    doc.head.append(base)
    const link = doc.createElement('link')
    const style = doc.createElement('style')
    const div = doc.createElement('div')
    doc.head.append(link, style)
    doc.body.append(div)

    expect(archive.attributeValue(link, 'href', 'css/site.css')).toBe(
      'blob:test/0'
    )
    expect(archive.attributeValue(div, 'href', 'css/site.css')).toBe(
      'css/site.css'
    )
    expect(
      archive.attributeValue(div, 'style', 'background:url(/fonts/icons.woff2)')
    ).toBe('background:url("blob:test/1")')
    expect(archive.textValue(style, '.a{src:url(/fonts/icons.woff2)}')).toBe(
      '.a{src:url("blob:test/1")}'
    )
    expect(archive.textValue(div, 'url(/fonts/icons.woff2)')).toBe(
      'url(/fonts/icons.woff2)'
    )
  })

  it('resolves a page with its own <base href> the way the trace writer did, so its stored stylesheet is found', () => {
    const archive = new ArchivedResources(fakeBlobs().api)
    archive.load([resource(SITE, 'p{}')])
    const host = document.createElement('div')
    render(
      replayDocument(
        {
          type: 'html',
          props: {
            children: [
              {
                type: 'head',
                props: {
                  children: [
                    { type: 'base', props: { href: '/css/' } },
                    {
                      type: 'link',
                      props: { rel: 'stylesheet', href: 'site.css' }
                    }
                  ]
                }
              }
            ]
          }
        },
        'https://site.test/login',
        (base) => archive.rewriterFor(base)
      ),
      host
    )

    expect(host.querySelector('base')?.getAttribute('href')).toBe(
      'https://site.test/css/'
    )
    expect(host.querySelector('link')?.getAttribute('href')).toBe('blob:test/0')
  })
})
