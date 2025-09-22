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
    args: ['--window-size=1600,1200']
  }
}

export const INTERNAL_COMMANDS = [
    'emit', 'browsingContextLocateNodes', 'browsingContextNavigate',
    'waitUntil', 'getTitle', 'getUrl', 'getWindowSize', 'setWindowSize', 'deleteSession',
    'findElementFromShadowRoot', 'findElementsFromShadowRoot', 'waitForExist', 'browsingContextGetTree',
    'scriptCallFunction', 'getElement', 'execute', 'findElement'
]

export const CONTEXT_CHANGE_COMMANDS = [
  'url', 'back', 'forward', 'refresh', 'switchFrame', 'newWindow', 'createWindow', 'closeWindow'
]

export const SPEC_FILE_PATTERN = /(test|spec|features)[\\/].*\.(js|ts)$/i
