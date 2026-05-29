/**
 * Loads the @wdio/selenium-devtools plugin and configures it.
 *
 * Run from the package root:  pnpm example:cucumber
 */

import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 },
  headless: true
})
