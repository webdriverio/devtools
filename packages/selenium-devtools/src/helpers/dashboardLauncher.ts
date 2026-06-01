import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'

const log = logger('@wdio/selenium-devtools:dashboardLauncher')

/**
 * Spawn a detached Chrome window pointed at the DevTools UI. `open` would
 * merge into an existing Chrome process and lose `--user-data-dir` isolation,
 * so we invoke the binary directly via a double-fork — the intermediate Node
 * process exits immediately and Chrome is reparented to launchd/init, so it
 * survives tree-kill by the test runner (vitest's worker pool, jest
 * --forceExit, mocha SIGINT). The unique user-data-dir is also used by
 * gracefulShutdown's pkill to target only THIS run's window.
 */
export function openDashboard(host: string, port: number): boolean {
  const url = `http://${host}:${port}`
  const chromeBin = findChromeBinary()
  if (!chromeBin) {
    log.warn(`Chrome binary not found. Open manually: ${url}`)
    return false
  }

  const userDataDir = path.join(
    os.tmpdir(),
    `selenium-devtools-ui-${port}-${Date.now()}`
  )

  log.info(`Chrome binary: ${chromeBin}`)
  log.info(`💡 Opening DevTools UI: ${url}`)
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1200',
    '--new-window',
    url
  ]
  try {
    const code =
      'require("child_process")' +
      `.spawn(${JSON.stringify(chromeBin)}, ${JSON.stringify(chromeArgs)}, { detached: true, stdio: "ignore" }).unref()`
    const intermediate = spawn(process.execPath, ['-e', code], {
      detached: true,
      stdio: 'ignore'
    })
    intermediate.unref()
    intermediate.on('error', (err) => {
      log.warn(
        `Could not auto-open DevTools UI (${err.message}). Open manually: ${url}`
      )
    })
    return true
  } catch (err) {
    log.warn(
      `Could not auto-open DevTools UI (${errorMessage(err)}). Open manually: ${url}`
    )
    return false
  }
}

function findChromeBinary(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
          ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c
    }
  }
  return null
}
