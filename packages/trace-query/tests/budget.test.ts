import { describe, expect, it } from 'vitest'
import {
  clipText,
  clipValue,
  fitted,
  itemBudget,
  itemBudgetBeside,
  pageOf,
  pageWith,
  truncateText
} from '../src/budget.js'
import { DEFAULT_MAX_CHARS, MIN_TEXT_CHARS } from '../src/constants.js'

const ITEMS = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']
const fourEach = { size: () => 4 }
// What the wrapper of a five-item listing with no scope costs, so item budgets below read as plain numbers.
const WRAPPER = JSON.stringify({
  items: [],
  total: 5,
  nextCursor: '5/5/811c9dc5'
}).length

const budgetFor = (items: number) => WRAPPER + 4 * items + (items - 1)

describe('pageOf', () => {
  it('returns every item and no cursor when they fit', () => {
    expect(pageOf(ITEMS, { maxChars: 200 }, fourEach)).toEqual({
      items: ITEMS,
      total: 5
    })
  })

  it('stops before the item that would exceed the budget, separators and wrapper included', () => {
    const page = pageOf(ITEMS, { maxChars: budgetFor(2) }, fourEach)
    expect(page.items).toEqual(['aaaa', 'bbbb'])
    expect(page.nextCursor).toMatch(/^2\/5\/[0-9a-f]{8}$/)
    expect(
      pageOf(ITEMS, { maxChars: budgetFor(2) - 1 }, fourEach).items
    ).toEqual(['aaaa'])
  })

  it('continues from the cursor it returned', () => {
    const request = { maxChars: budgetFor(2) }
    const first = pageOf(ITEMS, request, fourEach)
    const second = pageOf(
      ITEMS,
      { ...request, cursor: first.nextCursor },
      fourEach
    )
    const third = pageOf(
      ITEMS,
      { ...request, cursor: second.nextCursor },
      fourEach
    )
    expect([second.items, third.items]).toEqual([['cccc', 'dddd'], ['eeee']])
    expect(third.nextCursor).toBeUndefined()
  })

  it('holds one item that alone exceeds the budget, so paging advances', () => {
    const page = pageOf(['x'.repeat(50), 'y'], { maxChars: 10 })
    expect(page.items).toEqual(['x'.repeat(50)])
    expect(page.nextCursor).toMatch(/^1\/2\//)
  })

  it('serializes a full page within its budget', () => {
    const items = Array.from({ length: 2_000 }, (_, i) => ({
      title: `row ${i} "quoted"`,
      n: i
    }))
    let cursor: string | undefined
    const seen: unknown[] = []
    do {
      const page = pageOf(items, { maxChars: 1_000, cursor }, { scope: 's' })
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(1_000)
      expect(page.items.length).toBeGreaterThan(1)
      seen.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(items)
    const full = pageOf(items)
    expect(JSON.stringify(full).length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS)
    expect(JSON.stringify(full).length).toBeGreaterThan(DEFAULT_MAX_CHARS - 40)
  })

  it('returns an empty last page at the end of the result', () => {
    const last = pageOf(ITEMS, { maxChars: budgetFor(5) - 1 }, fourEach)
    const end = pageOf(ITEMS, { cursor: last.nextCursor }, fourEach)
    expect(end.items).toEqual(['eeee'])
    const after = pageOf(
      ITEMS,
      { cursor: last.nextCursor!.replace(/^4/, '5') },
      fourEach
    )
    expect(after).toEqual({ items: [], total: 5 })
  })

  it.each([
    '-1/5/811c9dc5',
    '1.5/5/811c9dc5',
    'abc',
    '01/5/811c9dc5',
    '2',
    '',
    '2/5',
    '2/05/811c9dc5',
    '2/5/811C9DC5'
  ])('refuses the malformed cursor %j', (cursor) => {
    expect(() => pageOf(ITEMS, { cursor })).toThrow(/Invalid cursor/)
  })

  it.each(['2/9/811c9dc5', '6/5/811c9dc5', '0/4/811c9dc5', '2/5/00000000'])(
    'refuses the cursor %j of a different listing',
    (cursor) => {
      expect(() => pageOf(ITEMS, { cursor })).toThrow(/different listing/)
    }
  )

  it('refuses the cursor of an equally long listing with another scope', () => {
    const request = { maxChars: budgetFor(2) }
    const { nextCursor } = pageOf(ITEMS, request, { ...fourEach, scope: 'a' })
    expect(
      pageOf(
        ITEMS,
        { ...request, cursor: nextCursor },
        { ...fourEach, scope: 'a' }
      ).items
    ).toEqual(['cccc', 'dddd'])
    expect(() =>
      pageOf(
        ITEMS,
        { ...request, cursor: nextCursor },
        { ...fourEach, scope: 'b' }
      )
    ).toThrow(/different listing/)
  })

  it.each([0, -3, 2.5, Number.NaN])('refuses maxChars %s', (maxChars) => {
    expect(() => pageOf(ITEMS, { maxChars })).toThrow(/maxChars/)
  })
})

describe('truncateText', () => {
  it('keeps text within the budget whole', () => {
    expect(truncateText('hello', 5)).toEqual({
      text: 'hello',
      totalChars: 5,
      truncated: false
    })
  })

  it('cuts text past the budget and says how long it was', () => {
    expect(truncateText('hello world', 5)).toEqual({
      text: 'hello',
      totalChars: 11,
      truncated: true
    })
  })

  it('never cuts inside a surrogate pair', () => {
    expect(truncateText('ab\u{1F600}cd', 3)).toEqual({
      text: 'ab',
      totalChars: 6,
      truncated: true
    })
  })

  it('keeps a surrogate pair that ends exactly at the budget', () => {
    expect(truncateText('ab\u{1F600}cd', 4).text).toBe('ab\u{1F600}')
  })

  it('uses the default budget when none is named', () => {
    const text = 'x'.repeat(DEFAULT_MAX_CHARS + 1)
    expect(truncateText(text).text).toHaveLength(DEFAULT_MAX_CHARS)
  })
})

describe('clipText', () => {
  it('keeps text within the budget as it is', () => {
    expect(clipText('hello', 5)).toBe('hello')
  })

  it('cuts text past the budget, the note of its length included', () => {
    const text = 'x'.repeat(100)
    expect(clipText(text, 40)).toBe(`${'x'.repeat(22)}… (cut, 100 chars)`)
    expect(clipText(text, 40)).toHaveLength(40)
  })

  it('keeps one character and the note when the budget is shorter than the note', () => {
    expect(clipText('hello world', 5)).toBe('h… (cut, 11 chars)')
  })
})

describe('clipValue', () => {
  it('writes a value as JSON, so a string reads apart from a number', () => {
    expect(clipValue('5', 10)).toBe('"5"')
    expect(clipValue(5, 10)).toBe('5')
  })

  it('cuts a long value', () => {
    expect(clipValue(['a'.repeat(40)], 30)).toBe(
      '["aaaaaaaaaaa… (cut, 44 chars)'
    )
  })

  it('has nothing for a value with no JSON form', () => {
    expect(clipValue(undefined, 10)).toBeUndefined()
  })
})

describe('pageWith', () => {
  const items = Array.from(
    { length: 30 },
    (_, i) => `item ${i} ${'x'.repeat(40)}`
  )
  const extra = {
    byLevel: { error: 3, log: 27 },
    origin: 'http://127.0.0.1:4567'
  }

  it('pays for the fields beside the items out of the same budget', () => {
    const page = pageWith(items, { maxChars: 1_000 }, { scope: 's' }, extra)
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(1_000)
    expect(page).toMatchObject(extra)
    const without = pageOf(items, { maxChars: 1_000 }, { scope: 's' })
    expect(page.items.length).toBeLessThan(without.items.length)
  })

  it('pages to the end with the cursor it returns, every page within the budget', () => {
    let cursor: string | undefined
    const seen: string[] = []
    do {
      const page = pageWith(
        items,
        { maxChars: 1_000, cursor },
        { scope: 's' },
        extra
      )
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(1_000)
      seen.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(items)
  })

  it('leaves each item what the page has once the fields beside it are paid for', () => {
    const request = { maxChars: 1_000 }
    expect(itemBudgetBeside(items.length, request, 's', extra)).toBe(
      itemBudget(items.length, 1_000, 's') - (JSON.stringify(extra).length - 1)
    )
  })
})

describe('fitted', () => {
  it('cuts the text until the whole item fits, never below MIN_TEXT_CHARS', () => {
    const text = 'y'.repeat(5_000)
    const build = (maxChars: number) => ({ text: clipText(text, maxChars) })
    expect(
      JSON.stringify(fitted(build, 2_000, 500)).length
    ).toBeLessThanOrEqual(500)
    expect(fitted(build, 2_000, 10).text).toHaveLength(MIN_TEXT_CHARS)
  })
})
