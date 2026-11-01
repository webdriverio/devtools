import { describe, expect, it } from 'vitest'

import { dashboardLaunchCommand } from '../src/helpers/dashboardLauncher.js'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ARGS = ['--user-data-dir=/tmp/x', 'http://localhost:3000']

describe('dashboardLaunchCommand', () => {
  it('opens behind the current window on macOS when the browser under test must keep the front', () => {
    expect(dashboardLaunchCommand(CHROME, ARGS, true, 'darwin')).toEqual({
      command: 'open',
      args: [
        '-n',
        '-g',
        '-a',
        '/Applications/Google Chrome.app',
        '--args',
        ...ARGS
      ]
    })
  })

  it('invokes the binary directly otherwise', () => {
    expect(dashboardLaunchCommand(CHROME, ARGS, false, 'darwin')).toEqual({
      command: CHROME,
      args: ARGS
    })
    expect(
      dashboardLaunchCommand('/usr/bin/google-chrome', ARGS, true, 'linux')
    ).toEqual({
      command: '/usr/bin/google-chrome',
      args: ARGS
    })
  })
})
