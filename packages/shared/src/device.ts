// The device a capture was recorded on. A native mobile session reports this
// only through its capabilities, and every consumer that wants to know "was
// this a phone?" reads it through `deviceFromCapabilities` rather than
// re-deriving it from a heuristic.

/** Native platforms a session can run on. */
export const NATIVE_PLATFORMS = ['android', 'ios'] as const

export type NativePlatform = (typeof NATIVE_PLATFORMS)[number]

export function isNativePlatform(value: unknown): value is NativePlatform {
  return NATIVE_PLATFORMS.includes(value as NativePlatform)
}

/** The device a capture was recorded on, as far as the session could tell. */
export interface DeviceInfo {
  platform: NativePlatform
  /** Friendly model name (`Pixel 7`, `iPhone 17`); absent when the session
   *  reported only a hardware serial. */
  name?: string
  /** OS version the session reported (`18.1`, `16`). */
  version?: string
}

/**
 * Capability keys holding a device's name, in the order that reads correctly on
 * real hardware:
 *
 * - a local run puts the requested name in `appium:deviceName`
 * - a device cloud + Android reports the hardware serial as BOTH `deviceName`
 *   and `udid`, and the friendly name only in `deviceModel`
 * - iOS reports a friendly `deviceName` with `udid` separate
 *
 * so `deviceModel` has to be preferred over `deviceName`, and any candidate
 * that merely repeats the serial is rejected — which is what keeps the cloud's
 * `deviceName` from winning.
 */
const DEVICE_NAME_KEYS = ['appium:deviceName', 'deviceModel', 'deviceName']
const SERIAL_KEYS = ['udid', 'appium:udid']
const PLATFORM_VERSION_KEYS = ['appium:platformVersion', 'platformVersion']

function capString(
  caps: Record<string, unknown>,
  key: string
): string | undefined {
  const value = caps[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** A capability read from the bag or from one level of vendor options. A device
 *  cloud commonly states `platformName` and `browserName` only inside its own
 *  bag (`bstack:options`), which is why WDIO's mobile detection reads there
 *  too; scanning one level needs no list of vendors to keep current.
 *
 *  Every caller passes MATCHED capabilities — what the session answered with —
 *  so a request-shaped bag's `firstMatch` array is deliberately not scanned: the
 *  server merges `alwaysMatch` with the ONE entry it chose, and reading a
 *  browser out of any entry would claim one the session never got. */
function deepCapString(
  caps: Record<string, unknown>,
  key: string
): string | undefined {
  const own = capString(caps, key)
  if (own) {
    return own
  }
  for (const nested of Object.values(caps)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const value = capString(nested as Record<string, unknown>, key)
      if (value) {
        return value
      }
    }
  }
  return undefined
}

/** Whether the capabilities name an Appium automation. Separate from naming a
 *  DEVICE: a Mac2, WinAppDriver or tvOS session has no document either, and
 *  `NATIVE_PLATFORMS` deliberately excludes them because that list chooses a
 *  device frame, which is a display concern. */
function namesAnAutomation(caps: Record<string, unknown>): boolean {
  return Boolean(
    deepCapString(caps, 'appium:automationName') ??
      deepCapString(caps, 'automationName')
  )
}

function firstCapString(
  caps: Record<string, unknown>,
  keys: string[],
  reject: (value: string) => boolean = () => false
): string | undefined {
  for (const key of keys) {
    const value = deepCapString(caps, key)
    if (value && !reject(value)) {
      return value
    }
  }
  return undefined
}

/**
 * Read the device out of a session's capabilities, or undefined when the
 * session was not a native mobile one. The single reader for this fact: a
 * capture states it on the way out (`context-options.device`) and the trace
 * reader narrows it on the way back in, so no consumer has to guess.
 */
export function deviceFromCapabilities(
  capabilities: unknown
): DeviceInfo | undefined {
  if (!capabilities || typeof capabilities !== 'object') {
    return undefined
  }
  const caps = capabilities as Record<string, unknown>
  const platform = deepCapString(caps, 'platformName')?.toLowerCase()
  if (!isNativePlatform(platform)) {
    return undefined
  }
  const serials = SERIAL_KEYS.map((key) => deepCapString(caps, key)).filter(
    (value): value is string => value !== undefined
  )
  const name = firstCapString(caps, DEVICE_NAME_KEYS, (value) =>
    serials.includes(value)
  )
  const version = firstCapString(caps, PLATFORM_VERSION_KEYS)
  return {
    platform,
    ...(name ? { name } : {}),
    ...(version ? { version } : {})
  }
}

/**
 * Whether a session had no web document to run page script in — it drove an
 * app rather than a browser. The question every adapter has to answer before a
 * DOM drain, a page-script probe or a viewport read, since each of those is a
 * round trip that can only fail on a native session.
 *
 * A device alone does not answer it: an Appium session driving Chrome or Safari
 * runs on a phone and has a real page. So the browser it names is the
 * discriminator — mobile web must state one, a native app states none.
 *
 * Capabilities rather than a driver flag, because capabilities are the one
 * thing all four adapters have.
 *
 * A device is not required — an Appium automation is enough. Answering "web"
 * for a document-less session is NOT the cheap direction: the service's
 * post-action settle reads a page tag, treats the failure as a navigation, and
 * then polls a probe that can only fail for its full 8 s timeout, per action.
 * So a Mac2 or tvOS session, which `NATIVE_PLATFORMS` excludes because that
 * list chooses a device frame, has to answer true here too.
 *
 * Residual: a hybrid app switched into a webview context does have a document,
 * and no capability can say so — only a runtime context read knows that. And a
 * bag this cannot read at all answers false, which is the expensive direction;
 * in practice every adapter reads capabilities straight off its own session.
 */
export function isNativeAppSession(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object') {
    return false
  }
  const caps = capabilities as Record<string, unknown>
  if (!deviceFromCapabilities(caps) && !namesAnAutomation(caps)) {
    return false
  }
  return !deepCapString(caps, 'browserName')
}

/**
 * Narrow a `device` read back off a trace's `context-options`. The field is
 * untrusted — a foreign zip may carry anything under that name, and one of ours
 * from before the field existed carries nothing — so a reader narrows here
 * rather than casting.
 */
export function isDeviceInfo(value: unknown): value is DeviceInfo {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    isNativePlatform(candidate.platform) &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.version === undefined || typeof candidate.version === 'string')
  )
}

/** `iPhone 17 (ios 18.1)` — one label for a device, so every consumer that
 *  shows it spells it the same way. */
export function deviceLabel(device: DeviceInfo): string {
  const version = device.version ? ` ${device.version}` : ''
  return device.name
    ? `${device.name} (${device.platform}${version})`
    : `${device.platform}${version}`
}
