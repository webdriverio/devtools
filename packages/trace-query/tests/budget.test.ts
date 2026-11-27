import { describe, expect, it } from 'vitest'
import { pageOf, truncateText } from '../src/budget.js'
import { DEFAULT_MAX_CHARS } from '../src/constants.js'

const ITEMS = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']
const fourEach = () => 4

describe('pageOf', () => {
  it('returns every item and no cursor when they fit', () => {
    expect(pageOf(ITEMS, { maxChars: 100 }, fourEach)).toEqual({
      items: ITEMS,
      total: 5
    })
  })

  it('stops before the item that would exceed the budget', () => {
    expect(pageOf(ITEMS, { maxChars: 9 }, fourEach)).toEqual({
      items: ['aaaa', 'bbbb'],
      total: 5,
      nextCursor: '2/5'
    })
  })

  it('continues from the cursor it returned', () => {
    const first = pageOf(ITEMS, { maxChars: 9 }, fourEach)
    const second = pageOf(
      ITEMS,
      { maxChars: 9, cursor: first.nextCursor },
      fourEach
    )
    const third = pageOf(
      ITEMS,
      { maxChars: 9, cursor: second.nextCursor },
      fourEach
    )
    expect([second.items, third.items]).toEqual([['cccc', 'dddd'], ['eeee']])
    expect(third.nextCursor).toBeUndefined()
  })

  it('holds one item that alone exceeds the budget, so paging advances', () => {
    expect(pageOf(['x'.repeat(50), 'y'], { maxChars: 10 })).toEqual({
      items: ['x'.repeat(50)],
      total: 2,
      nextCursor: '1/2'
    })
  })

  it('measures items as serialized JSON by default', () => {
    const items = [{ a: 1 }, { a: 2 }]
    expect(pageOf(items, { maxChars: 7 }).items).toEqual([{ a: 1 }])
    expect(pageOf(items, { maxChars: 14 }).items).toEqual(items)
  })

  it('uses the default budget when none is named', () => {
    const half = DEFAULT_MAX_CHARS / 2
    const fit = Array.from({ length: 3 }, () => 'x'.repeat(half))
    const over = Array.from({ length: 3 }, () => 'x'.repeat(half + 1))
    const length = (item: string) => item.length
    expect(pageOf(fit, {}, length).items).toHaveLength(2)
    expect(pageOf(over, {}, length).items).toHaveLength(1)
  })

  it('returns an empty last page at the end of the result', () => {
    expect(pageOf(ITEMS, { cursor: '5/5' }, fourEach)).toEqual({
      items: [],
      total: 5
    })
  })

  it.each(['-1/5', '1.5/5', 'abc', '01/5', '2', '', '2/05'])(
    'refuses the malformed cursor %j',
    (cursor) => {
      expect(() => pageOf(ITEMS, { cursor })).toThrow(/Invalid cursor/)
    }
  )

  it.each(['2/9', '6/5', '0/4'])(
    'refuses the cursor %j of a different listing',
    (cursor) => {
      expect(() => pageOf(ITEMS, { cursor })).toThrow(/different listing/)
    }
  )

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
