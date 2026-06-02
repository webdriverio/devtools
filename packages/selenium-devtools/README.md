# @wdio/selenium-devtools

> Selenium WebDriver adapter for [WebdriverIO DevTools](../../README.md) — runner-agnostic visual debugging UI for any `selenium-webdriver` test, regardless of the test runner.

```bash
npm install @wdio/selenium-devtools
```

Works with **Mocha**, **Jest**, **Cucumber**, or plain `node script.js` — the plugin auto-detects the runner and wires test boundaries accordingly.

---

## Quick start (3 steps)

**1. Install the package** in your Selenium project:

```bash
npm install @wdio/selenium-devtools
```

**2. Import it at the top of your test file**, BEFORE `selenium-webdriver`. The import has a side effect that hooks into Selenium, so the order matters:

```javascript
import '@wdio/selenium-devtools'              // <-- must be first
import { Builder, By } from 'selenium-webdriver'
```

**3. Run your tests as you normally do** — `mocha`, `jest`, `npm test`, whatever you use today. A new Chrome window opens automatically with the DevTools UI showing your test's commands, screenshots, console logs, and network activity in real time.

That's it. No other code changes required for Mocha / Jest / Cucumber.

---

## Setup per runner

Each block below is a **complete, copy-paste-ready example** including the `DevTools.configure(...)` call. Pick the runner you use, drop the snippet into your project, and run it. These mirror the working examples in [`example/`](./example).

### Mocha

```javascript
// tests/example.test.js
import { strict as assert } from 'node:assert'
import { Builder, By, until } from 'selenium-webdriver'
import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 }
})

describe('smoke test', function () {
  let driver

  before(async function () {
    driver = await new Builder().forBrowser('chrome').build()
  })

  after(async function () {
    if (driver) {
      await driver.quit()
    }
  })

  it('loads example.com and reads the heading', async function () {
    await driver.get('https://example.com')
    const heading = await driver.wait(until.elementLocated(By.css('h1')), 10000)
    assert.equal(await heading.getText(), 'Example Domain')
  })
})
```

Run it:

```bash
mocha --timeout 60000 tests/example.test.js
```

> Alternative: skip the per-file import and use `mocha --require @wdio/selenium-devtools` to load the plugin once for the whole run. You'll still need a separate one-time `DevTools.configure(...)` call somewhere if you want non-default options.

### Jest

```javascript
// test/example.js
import { DevTools } from '@wdio/selenium-devtools'
import { Builder, By, until } from 'selenium-webdriver'

DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 }
})

describe('login flow', () => {
  let driver

  beforeEach(async () => {
    driver = await new Builder().forBrowser('chrome').build()
  }, 60000)

  afterEach(async () => {
    if (driver) {
      await driver.quit()
    }
  })

  test('logs in with valid credentials', async () => {
    await driver.get('https://the-internet.herokuapp.com/login')
    await driver.findElement(By.id('username')).sendKeys('tomsmith')
    await driver.findElement(By.id('password')).sendKeys('SuperSecretPassword!')
    await driver.findElement(By.css('button[type="submit"]')).click()

    await driver.wait(until.urlContains('/secure'), 10000)
    const flash = await driver.findElement(By.id('flash'))
    expect(await flash.getText()).toMatch(/You logged into a secure area/i)
  }, 60000)
})
```

`jest.config.json`:

```json
{
  "testEnvironment": "node",
  "testMatch": ["<rootDir>/test/example.js"],
  "testTimeout": 60000,
  "transform": {}
}
```

Run it (ESM needs the experimental flag):

```bash
NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.json
```

### Cucumber

Cucumber's split layout means three small files — one to configure the plugin, one for World/hooks, and one for step definitions. They mirror [`example/cucumber-test/`](./example/cucumber-test).

`features/support/setup.js` — load the plugin and configure once:

```javascript
import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 }
})
```

`features/support/world.js` — driver lifecycle (Before / After):

```javascript
import {
  setWorldConstructor,
  World,
  Before,
  After,
  setDefaultTimeout
} from '@cucumber/cucumber'
import { Builder } from 'selenium-webdriver'

setDefaultTimeout(60000)

class CustomWorld extends World {
  constructor (options) {
    super(options)
    this.driver = null
  }
}

setWorldConstructor(CustomWorld)

Before(async function () {
  this.driver = await new Builder().forBrowser('chrome').build()
})

After(async function () {
  if (this.driver) {
    await this.driver.quit()
    this.driver = null
  }
})
```

`cucumber.json` — wire the setup file in first so the plugin patches Selenium before any step runs:

```json
{
  "default": {
    "import": [
      "features/support/setup.js",
      "features/support/world.js",
      "features/support/steps.js"
    ],
    "paths": ["features/*.feature"],
    "format": ["progress"]
  }
}
```

Run it:

```bash
cucumber-js --config cucumber.json
```

### Plain Node script (no test runner)

If you run `node tests/google.test.js` directly — no Mocha, no Jest — there's no runner for the plugin to auto-hook. You get a single "Selenium Session" row in the dashboard by default. To get a named test boundary instead, call `DevTools.startTest` / `endTest` around your work:

```javascript
// tests/google.test.js
import { DevTools } from '@wdio/selenium-devtools'
import { Builder, By, until, Key } from 'selenium-webdriver'

DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 },
  headless: false
})

async function run () {
  DevTools.startTest('search Google for Selenium')   // optional — names the test row

  const driver = await new Builder().forBrowser('chrome').build()
  try {
    await driver.get('https://www.google.com')
    const searchBox = await driver.findElement(By.name('q'))
    await searchBox.sendKeys('Selenium WebDriver JavaScript', Key.ENTER)
    await driver.wait(until.titleContains('Selenium'), 10000)

    DevTools.endTest('passed')
  } catch (err) {
    DevTools.endTest('failed')
    throw err
  } finally {
    await driver.quit()
  }
}

run()
```

Run it:

```bash
node tests/google.test.js
```

> Only use `startTest` / `endTest` for plain Node scripts. Under Mocha / Jest / Cucumber the plugin already knows when each test starts and ends — calling these manually would create duplicate rows in the dashboard.

---

## Configuration options explained

The runner snippets above use a typical config:

```javascript
DevTools.configure({
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 }
})
```

Here's what every option does, in plain language. **All are optional** — the plugin runs fine with `DevTools.configure({})` or no configure call at all.

> **For CI**, set both `headless: true` (hide the test browser) and `openUi: false` (don't try to open the dashboard window). The backend stays running on the configured port so you can still open the UI later.

#### `screencast` — record a video of the browser
**Default:** off. Set `{ enabled: true }` to record a `.webm` video for every browser session. Watch it back in the "Screencast" tab in the dashboard.

```javascript
DevTools.configure({
  screencast: { enabled: true, quality: 70 }
})
```

Detailed sub-options: `quality` (0–100 JPEG quality, default 70), `maxWidth`/`maxHeight` (frame size, default 1280×720), `captureFormat` (`'jpeg'` or `'png'`), `pollIntervalMs` (used for non-Chrome browsers; default 200ms).

Uses Chrome DevTools Protocol push mode where available; falls back to screenshot polling for Firefox / Safari with no config change.

#### `headless` — hide the test browser window
**Default:** `false` (the test browser is visible). Set to `true` to run the **test** browser without a window — useful for CI servers or when the popping window is annoying. The dashboard window is unaffected and still opens.

```javascript
DevTools.configure({ headless: true })
```

> Caveat: this injects `--headless=old` into Chrome options. `--headless=new` (Chrome's newer headless mode) is intentionally **not** used because it produces all-black frames in the video recording.

#### `openUi` — should the dashboard auto-open?
**Default:** `true`. Set to `false` if you don't want the plugin to launch a Chrome window for the dashboard — handy for CI where there's no display. The backend still runs at `http://localhost:3000`; you can open it manually if you want.

```javascript
DevTools.configure({ openUi: false })
```

#### `port` and `hostname` — change where the dashboard runs
**Defaults:** port `3000`, hostname `'localhost'`. If port 3000 is already taken, the plugin automatically tries 3001, 3002, etc., so you usually don't need to touch these.

```javascript
DevTools.configure({ port: 4000, hostname: '0.0.0.0' })
```

#### `captureScreenshots` — turn off per-command screenshots
**Default:** `true` (a screenshot is taken after every Selenium command). Set to `false` for faster tests on long suites where you don't need visual debugging.

```javascript
DevTools.configure({ captureScreenshots: false })
```

#### `rerunCommand` — customize the dashboard's "rerun this test" button
**Default:** auto-detected from your `npm`/`pnpm`/`yarn` script + the runner's filter flag (e.g. Mocha's `--grep`, Jest's `--testNamePattern`). Override if your invocation needs something special. Use `{{testName}}` where the test name should be substituted.

```javascript
DevTools.configure({ rerunCommand: 'npm test -- --grep "{{testName}}"' })
```

---

## Common recipes

| I want to… | Configuration |
|---|---|
| Record a video of every test | `DevTools.configure({ screencast: { enabled: true } })` |
| Run in CI without opening the dashboard window | `DevTools.configure({ openUi: false })` |
| Hide the test browser (CI / headless) | `DevTools.configure({ headless: true })` |
| Faster tests; skip screenshots | `DevTools.configure({ captureScreenshots: false })` |
| Move the dashboard off port 3000 | `DevTools.configure({ port: 4000 })` |
| All of the above for CI | `DevTools.configure({ headless: true, openUi: false, screencast: { enabled: true } })` |

---

## Reference — all options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Port for the DevTools backend server. Auto-incremented if already in use. |
| `hostname` | `string` | `'localhost'` | Hostname the backend server binds to. |
| `openUi` | `boolean` | `true` | Auto-open the DevTools UI in a new Chrome window. Set `false` for CI. |
| `captureScreenshots` | `boolean` | `true` | Capture a screenshot after every WebDriver command. |
| `headless` | `boolean` | `false` | Run the **test** browser headless (injects `--headless=old`). The DevTools UI window is unaffected. |
| `screencast` | `ScreencastOptions` | `{ enabled: false }` | Per-session `.webm` video recording. See sub-options below. |
| `rerunCommand` | `string` | auto | Command template for per-test rerun. `{{testName}}` is substituted. Auto-derived from runner argv if omitted. |

`ScreencastOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable per-session recording. |
| `captureFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Frame format. Chromium-only. |
| `quality` | `number` | `70` | JPEG quality 0–100. Chromium-only. |
| `maxWidth` | `number` | `1280` | Max frame width pushed over CDP. Chromium-only. |
| `maxHeight` | `number` | `720` | Max frame height pushed over CDP. Chromium-only. |
| `pollIntervalMs` | `number` | `200` | Fallback `takeScreenshot` poll interval for non-Chromium browsers. |

---

## Public API

```javascript
import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure(opts)             // set runtime options (see above)
DevTools.startTest(name, meta?)      // mark a named test boundary (plain Node scripts only)
DevTools.endTest('passed'|'failed'|'skipped'|'pending')
```

---

## Examples

Working smoke tests are included for each supported runner:

| Directory | Runner | Command |
|-----------|--------|---------|
| [`example/mocha-test/`](./example/mocha-test) | Mocha | `pnpm example:mocha` |
| [`example/jest-test/`](./example/jest-test) | Jest | `pnpm example:jest` |
| [`example/cucumber-test/`](./example/cucumber-test) | Cucumber | `pnpm example:cucumber` |

Build the package first:

```bash
# From repo root
pnpm build --filter @wdio/selenium-devtools
cd packages/selenium-devtools
pnpm example:mocha
```

---

## How it works

The plugin patches `selenium-webdriver`'s `Builder`, `WebDriver`, and `WebElement` prototypes at import time:

- **`Builder.build()`** → after construction, the driver instance is registered with the session capturer and the DevTools backend is started in a detached child process.
- **Every public `WebDriver` / `WebElement` method** → wrapped with command capture (args + result + screenshot + call source).
- **`WebDriver.quit()`** → awaited cleanup hook flushes screencast encoding, WebSocket buffer, and final metadata before the original quit runs.

When BiDi is available (Chrome ≥114), console logs, JavaScript exceptions, and network events stream directly via the Selenium BiDi handlers. Otherwise the plugin falls back to an injected browser-side collector script.

> The BiDi attach + inspector wiring lives in [`@wdio/devtools-core`'s `bidi.ts`](../core/src/bidi.ts) (`loadSeleniumSubmodule`, `attachBidiHandlers`, `arrayHeadersToObject`) — the same helpers nightwatch-devtools uses when its `bidi: true` opt-in is enabled. This adapter's `bidi.ts` keeps only the selenium-specific Builder-cap helpers (`ensureBidiCapability`, `ensureHeadlessChrome`) and the `buildBidiSinks` wrapper.

### Performance API capture

After every navigation command (`get`, `navigate`, `navigateTo`, etc.), the plugin runs the shared `CAPTURE_PERFORMANCE_SCRIPT` from `@wdio/devtools-core` to read `window.performance.getEntriesByType('navigation' | 'resource')`, cookies, and document info. The result is attached to the command entry in the Actions tab so you see `loadTime` / `domReady` / `responseTime` / resource counts / cookies / document title per navigation.

Same script and post-processing (`applyPerformanceData`) used by `@wdio/devtools-service` and `@wdio/nightwatch-devtools` — uniform dashboard fields across all three adapters.

---

## Limitations

| Limitation | Detail |
|-----------|--------|
| Cucumber leaf-step rerun | Cucumber's `--name` filter targets scenarios, not individual Gherkin steps. The dashboard's per-step rerun is disabled under Cucumber. |
| Headless mode caveat | `headless: true` injects `--headless=old`; `--headless=new` produces all-black CDP frames. |
| Initial viewport | The dashboard's snapshot iframe falls back to 1280×800 until the first navigation completes and the browser-side collector reports the real viewport. |

## :page_facing_up: License

[MIT](/LICENSE)
