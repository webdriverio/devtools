import { describe, expect, it } from 'vitest'

import { cssUrlReferences, rewriteCssUrls } from '../src/css-urls.js'

const urls = (css: string) => cssUrlReferences(css).map((r) => [r.kind, r.url])

describe('cssUrlReferences', () => {
  it('finds url() in every quoting, and both @import forms', () => {
    const css = `@import "a.css"; @import url('b.css') screen;
      .x { background: url(img/c.png) } .y { src: url( "d.woff2" ) format("woff2") }
      @font-face { src: URL('e.ttf') }`

    expect(urls(css)).toEqual([
      ['import', 'a.css'],
      ['import', 'b.css'],
      ['url', 'img/c.png'],
      ['url', 'd.woff2'],
      ['url', 'e.ttf']
    ])
  })

  it('ignores url( inside comments, strings and longer names', () => {
    const css =
      '/* url(no.css) */ .a::before { content: "url(no2.css)" } .b { x: myurl(no3) } .c { y: url(yes.png) }'

    expect(urls(css)).toEqual([['url', 'yes.png']])
  })

  it('reads escaped quotes inside a quoted url', () => {
    expect(urls('.a { b: url("we\\"ird.png") }')).toEqual([
      ['url', 'we"ird.png']
    ])
  })

  it('reads an escaped close paren inside an unquoted url as part of it', () => {
    expect(urls('.a { b: url(a\\).png) } .c { d: url(z.png) }')).toEqual([
      ['url', 'a).png'],
      ['url', 'z.png']
    ])
  })

  it('decodes hex escapes in strings and unquoted urls, eating one space after them', () => {
    expect(
      urls(
        '@import "\\66 ont.css"; .a { b: url(\\69 mg.png) } .c { d: url("x\\0y") }'
      )
    ).toEqual([
      ['import', 'font.css'],
      ['url', 'img.png'],
      ['url', 'x\ufffdy']
    ])
  })

  it('rewrites an escaped unquoted url without corrupting what follows', () => {
    expect(
      rewriteCssUrls(
        '.a{b:url(a\\).png)}.c{color:red}',
        (ref) => `blob:${ref.url}`
      )
    ).toBe('.a{b:url("blob:a).png")}.c{color:red}')
  })

  it('stays linear on a long run of escapes', () => {
    const hostile = 'url(' + '\\'.repeat(200_000)
    const started = performance.now()
    cssUrlReferences(hostile)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('skips a malformed url( rather than reading past it', () => {
    expect(urls('.a { b: url(x y) } .c { d: url(z.png) }')).toEqual([
      ['url', 'z.png']
    ])
  })

  it('scans a long hostile input in linear time', () => {
    const hostile = 'url('.repeat(50_000) + '/*' + '"'.repeat(50_000)
    const started = performance.now()
    cssUrlReferences(hostile)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('rewriteCssUrls', () => {
  it('rewrites the answered references and leaves the rest as written', () => {
    const css =
      '@import "a.css"; .x { background: url(keep.png) } .y { src: url(\'f.woff\') }'

    const out = rewriteCssUrls(css, (ref) =>
      ref.url === 'keep.png' ? undefined : `blob:${ref.url}`
    )

    expect(out).toBe(
      '@import "blob:a.css"; .x { background: url(keep.png) } .y { src: url("blob:f.woff") }'
    )
  })

  it('quotes a replacement so it cannot break out of the token', () => {
    expect(rewriteCssUrls('.a{b:url(x)}', () => 'q") ; evil')).toBe(
      '.a{b:url("q\\") ; evil")}'
    )
  })

  it('returns the text unchanged when nothing is rewritten', () => {
    const css = '.a { color: red }'
    expect(rewriteCssUrls(css, () => undefined)).toBe(css)
  })
})
