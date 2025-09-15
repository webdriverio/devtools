export const PAGE_TRANSITION_COMMANDS: string[] = [
  'url',
  'navigateTo',
  'elementClick'
]

export const DEFAULT_LAUNCH_CAPS: WebdriverIO.Capabilities = {
  browserName: 'chrome',
  'goog:chromeOptions': {
    // production:
    // args: ['--window-size=1200,800']
    // development:
    args: ['--window-size=1600,1200', '--auto-open-devtools-for-tabs']
  }
}
