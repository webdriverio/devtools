import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { TRACE_ZIP_ENTRIES } from '@wdio/devtools-shared'

import {
  checkPageResources,
  readStoredResourceUrls
} from '../smoke/page-resources.js'

const CSS = 'http://127.0.0.1:4567/css/fixture.css'
const FONT = 'http://127.0.0.1:4567/fonts/fixture-icons.woff2'

function zipWith(index: object[], stored: string[]): Uint8Array {
  return zipSync({
    [TRACE_ZIP_ENTRIES.pageResources]: strToU8(
      index.map((line) => JSON.stringify(line)).join('\n')
    ),
    ...Object.fromEntries(
      stored.map((sha1) => [
        `${TRACE_ZIP_ENTRIES.resourcesDir}/${sha1}`,
        strToU8('x')
      ])
    )
  })
}

describe('readStoredResourceUrls', () => {
  it('lists an indexed URL only when the zip holds its bytes', () => {
    const zip = zipWith(
      [
        { url: CSS, sha1: 'aaa' },
        { url: FONT, sha1: 'missing' }
      ],
      ['aaa']
    )
    expect(readStoredResourceUrls(zip)).toEqual([CSS])
  })

  it('lists nothing for a zip without the index', () => {
    expect(readStoredResourceUrls(zipSync({}))).toEqual([])
  })
})

describe('checkPageResources', () => {
  const expected = ['/css/fixture.css', '/fonts/fixture-icons.woff2']

  it('passes a zip storing every expected resource', () => {
    expect(
      checkPageResources(expected, [
        { path: 'a.zip', bytes: 1, storedResources: [CSS, FONT] }
      ])
    ).toEqual([])
  })

  it('names the zip and the resource it is missing', () => {
    const failures = checkPageResources(expected, [
      { path: 'a.zip', bytes: 1, storedResources: [CSS] }
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('a.zip stores no /fonts/fixture-icons.woff2')
  })

  it('checks nothing for an example that expects nothing', () => {
    expect(
      checkPageResources(undefined, [{ path: 'a.zip', bytes: 1 }])
    ).toEqual([])
  })
})
