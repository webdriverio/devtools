import { describe, expect, it, vi } from 'vitest'
import { traceConsole } from '../src/console.js'
import { traceNetwork } from '../src/network.js'
import { traceNetworkRequest } from '../src/network-request.js'
import type { TextContext } from '../src/returned-text.js'
import {
  openChromeTrace,
  openResourceTimingTrace
} from './console-network-traces.js'

// Redaction and untrusted-data marking hook in at returnedText, so every text a query returns must carry its mark.
vi.mock('../src/returned-text.js', async () => {
  const { clipText } = await import('../src/budget.js')
  return {
    returnedText: (text: string, context: TextContext) =>
      `<<${clipText(text, context.maxChars)}>>`
  }
})

const MARK = /<<[\s\S]*>>/

/** Values this package writes itself: ids, its own vocabularies, cursors and notes. */
const OWN_FIELDS = [
  'id',
  'level',
  'statusKind',
  'type',
  'nextCursor',
  'note',
  'source'
]

const OWN = new Set(OWN_FIELDS)

/** Every string a result holds, with its path, header names included, minus the fields this package writes itself. */
function returnedStrings(
  value: unknown,
  own: ReadonlySet<string>,
  path: string[] = []
): string[][] {
  const last = path[path.length - 1] ?? ''
  if (typeof value === 'string') {
    return own.has(last) ? [] : [[path.join('.'), value]]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, at) =>
      returnedStrings(item, own, [...path, `${at}`])
    )
  }
  if (value && typeof value === 'object') {
    const isHeaderMap = /Headers$/.test(last)
    return Object.entries(value).flatMap(([key, item]) => [
      ...(isHeaderMap ? [[[...path, '(name)'].join('.'), key]] : []),
      ...returnedStrings(item, own, [...path, key])
    ])
  }
  return []
}

function unmarked(result: unknown, own: ReadonlySet<string> = OWN): string[][] {
  return returnedStrings(result, own).filter(([, text]) => !MARK.test(text!))
}

describe('returnedText', () => {
  it('marks every text of a console listing', async () => {
    const page = traceConsole(await openChromeTrace(), {
      levels: [],
      maxLineChars: 30
    })
    expect(page.items.some((line) => line.source)).toBe(true)
    expect(unmarked(page, OWN)).toEqual([])
  })

  it('marks every text of a request listing, the origin included', async () => {
    const page = traceNetwork(await openChromeTrace())
    expect(page.origin).toMatch(MARK)
    expect(unmarked(page)).toEqual([])
  })

  it('marks every text of a Resource Timing listing', async () => {
    expect(unmarked(traceNetwork(await openResourceTimingTrace()))).toEqual([])
  })

  it.each(['0', '1', '2', '3'])(
    'marks every text of request %s with its body, header names included',
    async (id) => {
      const detail = await traceNetworkRequest(await openChromeTrace(), id, {
        body: true
      })
      expect(returnedStrings(detail, OWN).length).toBeGreaterThan(0)
      expect(unmarked(detail)).toEqual([])
    }
  )
})
