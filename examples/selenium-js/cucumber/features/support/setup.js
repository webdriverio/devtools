/**
 * Loads the @wdio/selenium-devtools plugin and configures it.
 *
 * Run from the package root:  pnpm example:cucumber
 */

import { DevTools } from '@wdio/selenium-devtools'

// mode defaults to 'live' (the demo default); set DEVTOOLS_MODE=trace to
// produce a trace.zip from this same example.
DevTools.configure({
  mode: process.env.DEVTOOLS_MODE === 'trace' ? 'trace' : 'live',
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 },
  headless: true
})
