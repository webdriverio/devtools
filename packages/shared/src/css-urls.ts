// The `url()` and `@import` references in CSS text, found by a single linear scan (never a regex, which backtracks on hostile input).

export type CssUrlKind = 'url' | 'import'

export interface CssUrlReference {
  /** The URL as written, quotes and escapes removed; not yet resolved. */
  url: string
  kind: CssUrlKind
  /** The token's span: `url(` to `)` inclusive, or an `@import` string with its quotes. */
  start: number
  end: number
}

const IMPORT = '@import'

function isIdentChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95 ||
    code > 127
  )
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

function skipSpace(css: string, from: number): number {
  let i = from
  while (i < css.length && isSpace(css[i])) {
    i++
  }
  return i
}

function isHex(ch: string | undefined): boolean {
  return ch !== undefined && /^[0-9a-fA-F]$/.test(ch)
}

/** The escape whose backslash is at `from`, decoded per CSS syntax: up to six hex digits and one optional space, or the next character as itself. */
function readEscape(css: string, from: number): { value: string; end: number } {
  let i = from + 1
  if (!isHex(css[i])) {
    return { value: css[i] ?? '', end: Math.min(i + 1, css.length) }
  }
  let hex = ''
  while (hex.length < 6 && isHex(css[i])) {
    hex += css[i]
    i++
  }
  if (isSpace(css[i])) {
    i += css[i] === '\r' && css[i + 1] === '\n' ? 2 : 1
  }
  const code = parseInt(hex, 16)
  const valid =
    code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
  return { value: String.fromCodePoint(valid ? code : 0xfffd), end: i }
}

/** A quoted string starting at `from`; `end` is past the closing quote (or the line end of an unterminated one). */
function readString(css: string, from: number): { value: string; end: number } {
  const quote = css[from]
  let value = ''
  let i = from + 1
  while (i < css.length) {
    const ch = css[i]
    if (ch === quote) {
      return { value, end: i + 1 }
    }
    if (ch === '\n') {
      return { value, end: i }
    }
    if (ch === '\\' && css[i + 1] === '\n') {
      // An escaped newline continues the string and adds nothing.
      i += 2
      continue
    }
    if (ch === '\\' && i + 1 < css.length) {
      const escape = readEscape(css, i)
      value += escape.value
      i = escape.end
      continue
    }
    value += ch
    i++
  }
  return { value, end: i }
}

/** An unquoted `url(` value from `from`; `end` stops at its `)` or whitespace, an escape read as part of the value. */
function readUnquotedUrl(
  css: string,
  from: number
): { value: string; end: number } {
  let value = ''
  let i = from
  while (i < css.length && css[i] !== ')' && !isSpace(css[i])) {
    if (css[i] === '\\' && css[i + 1] !== '\n' && i + 1 < css.length) {
      const escape = readEscape(css, i)
      value += escape.value
      i = escape.end
      continue
    }
    value += css[i]
    i++
  }
  return { value, end: i }
}

function startsWithAt(css: string, i: number, word: string): boolean {
  return css.slice(i, i + word.length).toLowerCase() === word
}

/** `url(` at `i`, as a function token rather than the tail of another name. */
function isUrlFunction(css: string, i: number): boolean {
  return (
    startsWithAt(css, i, 'url(') &&
    (i === 0 || !isIdentChar(css.charCodeAt(i - 1)))
  )
}

/** The `url(…)` token at `start`; a malformed one has no `ref`, and `end` is where its scan stopped, so nothing is read twice. */
function readUrlFunction(
  css: string,
  start: number,
  kind: CssUrlKind
): { ref?: CssUrlReference; end: number } {
  let i = skipSpace(css, start + 4)
  let url: string
  if (css[i] === '"' || css[i] === "'") {
    const str = readString(css, i)
    url = str.value
    i = skipSpace(css, str.end)
  } else {
    const unquoted = readUnquotedUrl(css, i)
    url = unquoted.value
    i = skipSpace(css, unquoted.end)
  }
  if (css[i] !== ')') {
    return { end: Math.max(i, start + 1) }
  }
  return { ref: { url, kind, start, end: i + 1 }, end: i + 1 }
}

/** Every URL reference in `css`, in source order. */
export function cssUrlReferences(css: string): CssUrlReference[] {
  const refs: CssUrlReference[] = []
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2)
      i = close === -1 ? css.length : close + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      i = readString(css, i).end
      continue
    }
    if (ch === '@' && startsWithAt(css, i, IMPORT)) {
      const at = skipSpace(css, i + IMPORT.length)
      if (css[at] === '"' || css[at] === "'") {
        const str = readString(css, at)
        refs.push({ url: str.value, kind: 'import', start: at, end: str.end })
        i = str.end
        continue
      }
      if (isUrlFunction(css, at)) {
        const read = readUrlFunction(css, at, 'import')
        if (read.ref) {
          refs.push(read.ref)
        }
        i = read.end
        continue
      }
      i = Math.max(at, i + 1)
      continue
    }
    if ((ch === 'u' || ch === 'U') && isUrlFunction(css, i)) {
      const read = readUrlFunction(css, i, 'url')
      if (read.ref) {
        refs.push(read.ref)
      }
      i = read.end
      continue
    }
    i++
  }
  return refs
}

function quoted(url: string): string {
  return `"${url.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, '')}"`
}

/** `css` with each reference `replace` answers for rewritten; undefined keeps the token as written. */
export function rewriteCssUrls(
  css: string,
  replace: (ref: CssUrlReference) => string | undefined
): string {
  let out = ''
  let last = 0
  for (const ref of cssUrlReferences(css)) {
    const next = replace(ref)
    if (next === undefined) {
      continue
    }
    const isImportString =
      ref.kind === 'import' && css[ref.start] !== 'u' && css[ref.start] !== 'U'
    out += css.slice(last, ref.start)
    out += isImportString ? quoted(next) : `url(${quoted(next)})`
    last = ref.end
  }
  return last === 0 ? css : out + css.slice(last)
}
