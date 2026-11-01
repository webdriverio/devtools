import { spawn } from 'node:child_process'

type Launch = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' }
) => {
  unref?: () => void
  on?: (event: 'error', cb: (err: Error) => void) => void
}

/** The session facts that decide whether the local desktop Safari is the one
 *  under test: an iOS session or one served from another host is not. */
export interface FocusTarget {
  browserName?: string
  platformName?: string
  /** The WebDriver endpoint's host; absent or loopback means this machine. */
  host?: string
  /** Where a failed `open` is reported; core has no logger of its own. */
  onError?: (message: string) => void
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Safari delivers synthesized mouse input only to its frontmost window, and
 *  a live run opens the dashboard in another browser, which takes that place:
 *  every click after that returned success and reached nothing. Brought back
 *  with `open -a`, which activates an app without AppleScript permissions. */
export function restoreBrowserFocus(
  target: FocusTarget,
  platform: NodeJS.Platform = process.platform,
  // node's spawn overloads do not narrow to this one call shape.
  launch: Launch = spawn as unknown as Launch
): boolean {
  const local = !target.host || LOCAL_HOSTS.has(target.host)
  if (
    platform !== 'darwin' ||
    !local ||
    !/safari/i.test(target.browserName ?? '') ||
    /ios/i.test(target.platformName ?? '')
  ) {
    return false
  }
  try {
    const child = launch('open', ['-a', 'Safari'], {
      detached: true,
      stdio: 'ignore'
    })
    child.on?.('error', (err) =>
      target.onError?.(`Could not bring Safari to the front: ${err.message}`)
    )
    child.unref?.()
    return true
  } catch (err) {
    target.onError?.(`Could not bring Safari to the front: ${String(err)}`)
    return false
  }
}
