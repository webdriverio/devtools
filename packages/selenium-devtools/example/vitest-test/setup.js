import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure({
  rerunCommand: 'npx vitest --testNamePattern "{{testName}}"',
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 },
  headless: true
})
