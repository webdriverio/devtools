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

/** Booted iOS simulators as `{ name, udid }`, or null when `xcrun simctl` is
 *  absent — the two are different failures and get different advice.
 *
 *  The udid matters: naming a simulator that does not exist does NOT fail, it
 *  makes the XCUITest driver CREATE one (`appiumTest-<uuid>-<name>`) and boot
 *  it, every run, beside the one already running. Identifying the device by
 *  udid is what makes a run attach to it instead. */
function bootedSimulators() {
  try {
    const out = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return out
      .split('\n')
      .filter((line) => line.includes('(Booted)'))
      .map((line) => {
        const match = line.match(
          /^\s*(.+?)\s+\(([0-9A-F-]{36})\)\s+\(Booted\)/i
        )
        return match ? { name: match[1], udid: match[2] } : null
      })
      .filter(Boolean)
  } catch {
    return null
  }
}

/** Appium is not listening. Shared, because the iOS and Android paths report
 *  it identically and only diverge on what they check next. */
const APPIUM_DOWN = (host, port) =>
  `\nNothing is listening on ${host}:${port}, so Appium is not up.\n\n` +
  `  appium --address ${host} --port ${port}\n`

/** The simulator to drive, as capabilities.
 *
 *  Always a udid, never a bare name. Naming a simulator that does not exist
 *  does NOT fail: the XCUITest driver CREATES it (`appiumTest-<uuid>-<name>`)
 *  and boots it, every run, beside the one already running. So an unmatched
 *  `IOS_DEVICE_NAME` is refused here rather than passed through — a typo would
 *  otherwise pass the preflight (which only asks whether SOME simulator is
 *  booted) and quietly leave a new simulator behind on every run.
 *
 *  Defaults to whatever is already booted, the iOS counterpart of attaching to
 *  the running Android emulator. `IOS_UDID` names one outright and is not
 *  checked against the booted list, so a remote device, a real one, or a
 *  freshly created simulator can still be targeted deliberately.
 *
 *  All of that is LOCAL policy. A remote or cloud Appium drives devices this
 *  machine cannot enumerate — `xcrun simctl` lists local simulators and nothing
 *  else — and naming one is how such a service selects it, so a name is passed
 *  straight through there rather than checked against a list it is not in. */
function resolveIosDevice({
  host = process.env.APPIUM_HOST ?? '127.0.0.1'
} = {}) {
  if (process.env.IOS_UDID) {
    return { 'appium:udid': process.env.IOS_UDID }
  }
  const wanted = process.env.IOS_DEVICE_NAME
  if (!LOCAL_HOSTS.has(host)) {
    return wanted ? { 'appium:deviceName': wanted } : {}
  }
  const booted = bootedSimulators() ?? []
  if (!booted.length) {
    throw new Error(
      'No iOS simulator is booted.\n' +
        '  xcrun simctl list devices available\n' +
        '  xcrun simctl boot "<device name>"'
    )
  }
  const names = booted.map((device) => device.name).join(', ')
  if (wanted) {
    const match = booted.find((device) => device.name === wanted)
    if (!match) {
      throw new Error(
        `IOS_DEVICE_NAME="${wanted}" is not booted, and naming a simulator ` +
          'that does not exist makes Appium create one rather than fail.\n' +
          `  booted now: ${names}\n` +
          '  boot it first, or set IOS_UDID to target it deliberately.'
      )
    }
    return { 'appium:udid': match.udid, 'appium:deviceName': match.name }
  }
  return { 'appium:udid': booted[0].udid, 'appium:deviceName': booted[0].name }
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
  if (process.env.DEVTOOLS_MOBILE_PLATFORM === 'ios') {
    // iOS has its own toolchain, so none of the Android checks below apply:
    // they look for ANDROID_HOME and an adb device, and a correctly set up
    // XCUITest machine has neither.
    if (!(await appiumReady(host, port))) {
      console.error(APPIUM_DOWN(host, port))
      process.exit(1)
    }
    if (!LOCAL_HOSTS.has(host)) {
      return
    }
    // A named device is the caller's own instruction, and `xcrun simctl` lists
    // local SIMULATORS and nothing else — so a real device plugged into this
    // machine has no entry here, and requiring one would refuse a run that is
    // correctly configured. `resolveIosDevice` passes the udid straight through
    // for the same reason.
    if (process.env.IOS_UDID) {
      return
    }
    const booted = bootedSimulators()
    if (booted === null) {
      console.error(
        '\n`xcrun simctl` is not available, so there is no iOS toolchain here.\n\n' +
          'Xcode is needed — the Command Line Tools alone ship no simulators:\n\n' +
          '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\n' +
          '  xcodebuild -downloadPlatform iOS\n'
      )
      process.exit(1)
    }
    if (!booted.length) {
      console.error(
        '\nNo iOS simulator is booted, so there is nothing to drive.\n\n' +
          '  xcrun simctl list devices available\n' +
          '  xcrun simctl boot "<device name>"\n'
      )
      process.exit(1)
    }
    return
  }
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

module.exports = {
  requireMobileToolchain,
  appiumReady,
  adbDevices,
  bootedSimulators,
  resolveIosDevice
}
