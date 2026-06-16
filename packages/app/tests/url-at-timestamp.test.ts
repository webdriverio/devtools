import { describe, expect, it } from 'vitest'
import type { CommandLog, TraceMutation } from '@wdio/devtools-shared'
import {
  urlAtTimestamp,
  commandPageUrl
} from '../src/components/browser/url-at-timestamp.js'

function nav(timestamp: number, url: string): TraceMutation {
  return {
    type: 'childList',
    addedNodes: [],
    removedNodes: [],
    timestamp,
    url
  }
}

function plain(timestamp: number): TraceMutation {
  return { type: 'attributes', addedNodes: [], removedNodes: [], timestamp }
}

describe('urlAtTimestamp', () => {
  const mutations = [
    nav(100, 'https://a.com'),
    plain(150),
    nav(200, 'https://b.com'),
    plain(250)
  ]

  it('returns the navigation active at the given time', () => {
    expect(urlAtTimestamp(mutations, 175)).toBe('https://a.com')
    expect(urlAtTimestamp(mutations, 230)).toBe('https://b.com')
  })

  it('includes a navigation that lands exactly on the timestamp', () => {
    expect(urlAtTimestamp(mutations, 200)).toBe('https://b.com')
  })

  it('returns undefined before any navigation', () => {
    expect(urlAtTimestamp(mutations, 50)).toBeUndefined()
  })

  it('ignores mutations without a url', () => {
    expect(urlAtTimestamp([plain(100), plain(200)], 300)).toBeUndefined()
  })

  it('picks the latest navigation regardless of array order', () => {
    const unordered = [nav(200, 'https://b.com'), nav(100, 'https://a.com')]
    expect(urlAtTimestamp(unordered, 250)).toBe('https://b.com')
  })
})

function cmd(command: string, timestamp: number, args: unknown[]): CommandLog {
  return { command, args, timestamp }
}

describe('commandPageUrl', () => {
  const urlA = cmd('url', 100, ['https://a.com'])
  const urlB = cmd('url', 300, ['https://b.com'])
  const typeOnB = cmd('setValue', 400, ['#q', 'hello'])
  const commands = [urlA, urlB, typeOnB]

  it('a navigation command resolves to its own destination', () => {
    expect(commandPageUrl(urlB, commands, [])).toBe('https://b.com')
  })

  it('a later command resolves to the most recent navigation before it', () => {
    // setValue ran on page B even when B was never captured as a mutation
    expect(commandPageUrl(typeOnB, commands, [])).toBe('https://b.com')
  })

  it('a command before any later navigation keeps the earlier page', () => {
    const typeOnA = cmd('setValue', 200, ['#q', 'hi'])
    expect(commandPageUrl(typeOnA, [urlA, urlB, typeOnA], [])).toBe(
      'https://a.com'
    )
  })

  it('falls back to the mutation stream when no navigation command exists', () => {
    const getText = cmd('getText', 200, ['#flash'])
    const mutations = [nav(100, 'https://a.com')]
    expect(commandPageUrl(getText, [getText], mutations)).toBe('https://a.com')
  })

  it('ignores non-URL navigation args (e.g. back/switchWindow)', () => {
    const back = cmd('back', 500, [])
    expect(commandPageUrl(back, [urlB, back], [])).toBe('https://b.com')
  })
})
