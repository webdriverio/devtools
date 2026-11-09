/**
 * Loads the @wdio/selenium-devtools plugin and configures it.
 *
 * Run from the package root:  pnpm example:cucumber
 */

import { DevTools } from '@wdio/selenium-devtools'

// mode defaults to 'live' (the demo default); set DEVTOOLS_MODE=trace to
// produce a trace.zip from this same example.
const MODE = ['trace', 'telemetry'].includes(process.env.DEVTOOLS_MODE)
  ? process.env.DEVTOOLS_MODE
  : 'live'

DevTools.configure({
  mode: MODE,
  // Live and telemetry modes warn that they ignore `enabled` (trace records via filmstrip/video).
  screencast: {
    ...(MODE === 'live' ? { enabled: true } : {}),
    quality: 70,
    maxWidth: 1280,
    maxHeight: 720
  },
  headless: true
})
