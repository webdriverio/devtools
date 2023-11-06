import type { WebDriverCommands } from '@wdio/protocols'

export const PAGE_TRANSITION_COMMANDS: (keyof WebDriverCommands)[] = [
  'navigateTo',
  'elementClick'
]
