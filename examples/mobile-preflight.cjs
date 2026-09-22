// Checks the mobile toolchain before a session is attempted, so a missing
// prerequisite reads as a prerequisite rather than as a driver failure.
//
// Without this the four frameworks each phrase the same missing Appium
// differently and none of them says what to do: WDIO reports "make sure browser
// driver is running", Nightwatch reports it could not reach GeckoDriver,
// selenium-webdriver reports ECONNREFUSED with a stack trace.
//
// CJS so the Nightwatch config can `require` it and the ESM examples can
// `import` it.

const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Hosts whose device this machine is expected to be able to see. A remote or
 *  cloud Appium needs no local SDK, so the local checks are skipped for it. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

/** Where the SDK sits when Android Studio put it there, so a run that only
 *  lacks the export can be told the exact line rather than the whole setup. */
function discoverSdk() {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/usr/local/share/android-sdk',
    '/opt/homebrew/share/android-sdk',
    // Where Google's CLI installer and the homebrew cask land the SDK. Its own
    // `android-cli info` may still report ~/Library/Android/sdk, which can be
    // empty — so the directory holding platform-tools is what counts here.
    '/usr/local/share/android-commandlinetools',
    '/opt/homebrew/share/android-commandlinetools'
  ]
  return candidates.find((dir) => existsSync(path.join(dir, 'platform-tools')))
}

const SETUP = `
Mobile examples need a device and Appium. Neither is bundled — between the
Android SDK and a system image this is a multi-gigabyte setup, so it is opt-in.

  1. Android SDK + an emulator (or a real device with USB debugging on).
     Android Studio installs both: https://developer.android.com/studio
     Then check the device is visible:

       adb devices

  2. Appium 2.x and the Android driver:

       npm i -g appium
       appium driver install uiautomator2
       appium --address 127.0.0.1 --port 4723

To look at mobile capture WITHOUT any of that, the scratchpad harness builds
mobile traces and drives a live mobile session with no device at all — see
the mobile-adapters README.
`

/** Whether Appium is answering. `/status` is unauthenticated and cheap. */
async function appiumReady(host, port) {
  try {
    const res = await fetch(`http://${host}:${port}/status`, {
      signal: AbortSignal.timeout(2500)
    })
    return res.ok
  } catch {
    return false
  }
}

/** Devices `adb` can see, or null when adb itself is missing — the two are
 *  worth telling apart, because one is "install the SDK" and the other is
 *  "start the emulator". */
function adbDevices() {
  try {
    const out = execFileSync('adb', ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return out
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('*'))
  } catch {
    return null
  }
}

/**
 * Whether the running Appium process has an SDK path in its own environment.
 * `true` / `false` when that could be determined, `null` when it could not.
 *
 * This looks at ANOTHER process on purpose, and it is the single most
 * confusing failure in the whole setup: the variable has to be exported in the
 * shell that STARTED Appium, because Appium's Android driver reads its own
 * environment. Exporting it where the test runs changes nothing, and the error
 * comes back through the client as a WebDriver session failure, which points at
 * the test rather than at the server.
 */
function appiumHasSdk() {
  try {
    const pids = execFileSync('pgrep', ['-f', 'appium'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split('\n')
      .filter(Boolean)
    if (!pids.length) {
      return null
    }
    // `ps eww` prints a process's environment on macOS and Linux; it may be
    // refused for a process owned by someone else, hence the null.
    const env = execFileSync('ps', ['eww', '-p', pids[0]], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    if (!/\bPATH=/.test(env)) {
      return null
    }
    return /\bANDROID_(HOME|SDK_ROOT)=\S/.test(env)
  } catch {
    return null
  }
}

/**
 * Print what is missing and exit, or return quietly. Exits rather than throws:
 * a thrown error inside a framework hook is reported as a test failure, which
 * is exactly the confusion this exists to remove.
 */
async function requireMobileToolchain({
  host = process.env.APPIUM_HOST ?? '127.0.0.1',
  port = Number(process.env.APPIUM_PORT ?? 4723)
} = {}) {
  if (await appiumReady(host, port)) {
    // A remote or cloud Appium drives a device this machine knows nothing
    // about, so none of the local checks below apply to it.
    if (!LOCAL_HOSTS.has(host)) {
      return
    }
    // Appium being up is NOT enough, and this is the case that made a 40-line
    // stack trace: its Android driver reads ANDROID_HOME/ANDROID_SDK_ROOT and
    // rejects the session with "Neither ANDROID_HOME nor ANDROID_SDK_ROOT
    // environment variable was exported" long before any of our code runs.
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    if (!sdk) {
      const found = discoverSdk()
      console.error(
        `\nAppium is up on ${host}:${port}, but neither ANDROID_HOME nor ` +
          'ANDROID_SDK_ROOT is set.\nIts Android driver needs one and will ' +
          'refuse the session without it.'
      )
      console.error(
        found
          ? `\nAn SDK looks present at ${found}, so this is all that is missing:\n\n` +
              `  export ANDROID_HOME=${found}\n` +
              `  export PATH="$PATH:${found}/platform-tools"\n`
          : SETUP
      )
      process.exit(1)
    }
    // Ours is set — but Appium's is the one that counts.
    if (appiumHasSdk() === false) {
      console.error(
        `\nAppium is up on ${host}:${port}, but its OWN environment has no\n` +
          'ANDROID_HOME or ANDROID_SDK_ROOT. Its Android driver reads that, so\n' +
          'exporting it here changes nothing — the session is refused and the\n' +
          'error arrives as a WebDriver failure that looks like a test problem.\n' +
          '\nRestart Appium from a shell that has it:\n\n' +
          `  export ANDROID_HOME=${sdk}\n` +
          `  export PATH="$PATH:${sdk}/platform-tools"\n` +
          '  appium --address 127.0.0.1 --port 4723\n'
      )
      process.exit(1)
    }
    const devices = adbDevices()
    if (devices && devices.length === 0) {
      console.error(
        `\nAppium is up on ${host}:${port}, but \`adb devices\` lists none.\n` +
          'Start an emulator or plug in a device, then run this again.\n'
      )
      process.exit(1)
    }
    return
  }

  const devices = adbDevices()
  console.error(
    `\nNothing is listening on ${host}:${port}, so Appium is not up.`
  )
  if (devices === null) {
    console.error(
      '`adb` is not on PATH either, so the SDK is likely missing too.'
    )
  } else if (devices.length) {
    console.error(
      `adb does see ${devices.length} device(s), so only Appium is missing.`
    )
  }
  console.error(SETUP)
  process.exit(1)
}

module.exports = { requireMobileToolchain, appiumReady, adbDevices }
