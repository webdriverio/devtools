# DevTools Hook

Hook your WebdriverIO project up with Devtools capabilities.

## Install

You can install the package via:

```sh
npm install @devtools/hook
```

## Usage

When initiating a standalone WebdriverIO session, just wrap the `remote` call with the `setupForDevtools` exported by the package as follows:

```ts
import { remote } from 'webdriverio'
import { setupForDevtools } from '@devtools/hook'

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
