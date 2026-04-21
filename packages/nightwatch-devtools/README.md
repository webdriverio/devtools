# @wdio/nightwatch-devtools

> Nightwatch adapter for [WebdriverIO DevTools](../../README.md) - brings the same visual debugging UI to your Nightwatch test suite with zero test code changes.

```bash
npm install @wdio/nightwatch-devtools
```

---

## Setup

### Standard Nightwatch (mocha-style)

```javascript
// nightwatch.conf.cjs
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default

module.exports = {
  src_folders: ['tests'],

  test_settings: {
    default: {
      desiredCapabilities: {
        browserName: 'chrome',
        // Required for network request capture
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
}
```

Run your tests as normal — the DevTools UI opens automatically in a new browser window:

```bash
nightwatch
```

> No changes to your test files are needed.

---

### Cucumber / BDD

Import `cucumberHooksPath` alongside the main export and pass it to the Cucumber `require` option. This registers `Before` / `After` scenario hooks that mirror the WebdriverIO service's `beforeScenario` / `afterScenario` behaviour.

```javascript
// nightwatch.conf.cjs
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default
const { cucumberHooksPath } = require('@wdio/nightwatch-devtools')

module.exports = {
  src_folders: ['features/step_definitions'],

  test_runner: {
    type: 'cucumber',
    options: {
      feature_path: 'features',
      require: [cucumberHooksPath]  // <-- register DevTools Cucumber hooks
    }
  },

  test_settings: {
    default: {
      desiredCapabilities: {
        browserName: 'chrome',
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
}
```

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Port for the DevTools backend server. Auto-incremented if already in use. |
| `hostname` | `string` | `'localhost'` | Hostname the backend server binds to. |

```javascript
globals: nightwatchDevtools({
  port: 3000,
  hostname: 'localhost'
})
```

---

## Examples

Working examples are included in this package:

| Directory | Runner | Command |
|-----------|--------|---------|
| [`example/`](./example) | Nightwatch mocha-style | `pnpm example` |

Build the package first:

```bash
# From repo root
pnpm build --filter @wdio/nightwatch-devtools
cd packages/nightwatch-devtools
pnpm example
```

---

## Limitations

Nightwatch does not provide the same depth of framework hooks as WebdriverIO, so there are a few differences from the WDIO DevTools service:

| Limitation | Detail |
|-----------|--------|
| No native command hooks | Nightwatch has no `beforeCommand` / `afterCommand` hook. Commands are intercepted via a browser proxy wrapper instead. |
| Limited test context | `browser.currentTest` provides less metadata than the WDIO runner context; test names and file paths require additional heuristics. |
| Flat suite nesting | Nightwatch does not natively support multiply-nested `describe` blocks; the plugin reports a maximum of two levels. |
| Delayed result availability | Test results are only finalised in `afterEach`, not available mid-test. |

Overall feature parity with the WebdriverIO DevTools service is approximately **80–90%**.

## :page_facing_up: License

[MIT](/LICENSE)
