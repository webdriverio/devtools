# DevTools Hook

Hook your WebdriverIO project up with Devtools capabilities.

## Install

You can install the package via:

```sh
npm install @devtools/hook
```

## Usage

You can collect WebdriverIO trace data within standalone or testrunner environments. Read more on these different modes in the [docs](https://webdriver.io/docs/setuptypes#standalone-mode).

### Standalone

When initiating a standalone WebdriverIO session, just wrap the `remote` call with the `setupForDevtools` exported by the package as follows:

```ts
import { remote } from 'webdriverio'
import { setupForDevtools } from '@wdio/devtools-service'

const browser = await remote(setupForDevtools({
    capabilities: {
        browserName: 'chrome',
        browserVersion: 'latest'
    }
}))

// call commands
// ...

await browser.deleteSession()
```

### Testrunner

To integrate WebdriverIO Devtools in your test runner, just add this service to your `wdio.conf.js` as follows:

```ts
export const config: WebdriverIO.Config = {
  // ...
  services: ['devtools']
  // ...
}
```
