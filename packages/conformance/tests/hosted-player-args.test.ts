import { describe, expect, it } from 'vitest'

import { parseCheckArgs } from '../hosted-player/args.js'
import { HOSTED_PREVIEW_PORT } from '../hosted-player/constants.js'

describe('parseCheckArgs', () => {
  it('serves the local build on the preview port by default', () => {
    expect(parseCheckArgs([])).toEqual({
      port: HOSTED_PREVIEW_PORT,
      headed: false
    })
  })

  it('takes a deployed player without its trailing slash', () => {
    expect(parseCheckArgs(['--url', 'https://trace.webdriver.io/']).url).toBe(
      'https://trace.webdriver.io'
    )
    expect(parseCheckArgs(['--url', 'https://example.test/player//']).url).toBe(
      'https://example.test/player'
    )
  })

  it('takes a port and a headed run', () => {
    expect(parseCheckArgs(['--port', '5000', '--headed'])).toEqual({
      port: 5000,
      headed: true
    })
  })

  it.each([
    [['--url', 'trace.webdriver.io'], /absolute URL/],
    [['--url', 'file:///tmp/index.html'], /http or https/],
    [['--url', 'https://trace.webdriver.io/?trace=x'], /page alone/],
    [['--port', '0'], /TCP port/],
    [['--port', 'abc'], /TCP port/],
    [['--port', '70000'], /TCP port/]
  ])('refuses %j', (argv, message) => {
    expect(() => parseCheckArgs(argv)).toThrow(message)
  })

  it('refuses an option it does not know and a positional', () => {
    expect(() => parseCheckArgs(['--headless'])).toThrow()
    expect(() => parseCheckArgs(['https://trace.webdriver.io'])).toThrow()
  })
})
