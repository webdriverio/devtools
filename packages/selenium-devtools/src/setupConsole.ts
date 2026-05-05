// MUST be the first import in `src/index.ts`. `loglevel` binds
// `console[method]` at logger-creation time, so we have to swap Jest/Vitest's
// buffered console for a plain Node Console before any logger is created.
import { Console } from 'node:console'

const protoName = Object.getPrototypeOf(globalThis.console)?.constructor?.name
if (protoName && protoName !== 'Console') {
  globalThis.console = new Console({
    stdout: process.stdout,
    stderr: process.stderr,
    colorMode: 'auto'
  })
}
