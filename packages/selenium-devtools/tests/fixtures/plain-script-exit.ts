// A plain script with no browser: it connects, opens its session test, registers the real process hooks and returns, so Node reaches beforeExit on its own.
import { registerProcessHooks } from '../../src/helpers/processHooks.js'
import { SessionCapturer } from '../../src/session.js'
import { onDriverEnd, onSessionEnd } from '../../src/session-lifecycle.js'
import { plainScriptCtx } from './plain-script-ctx.js'

const capturer = new SessionCapturer({
  hostname: '127.0.0.1',
  port: Number(process.env.PLAIN_SCRIPT_BACKEND_PORT)
})
await capturer.waitForConnection(5000)
const ctx = plainScriptCtx(capturer)
ctx.testManager!.getOrEnsureTest()
await onDriverEnd(ctx)

registerProcessHooks({
  isReuse: false,
  options: { port: 0 },
  sessionCapturer: capturer,
  clearKeepAlive: () => {},
  onSessionEnd: () => onSessionEnd(ctx)
})
