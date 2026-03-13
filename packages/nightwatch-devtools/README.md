# @wdio/nightwatch-devtools

> Nightwatch adapter for WebdriverIO DevTools - Visual debugging UI for your Nightwatch tests

## What is this?

Brings the powerful WebdriverIO DevTools visual debugging interface to Nightwatch tests with **zero test code changes**.

See everything in real-time:
- 📋 **Commands** - Every action executed
- 🖥️ **Console** - Browser console logs
- 🌐 **Network** - HTTP requests/responses
- ✅ **Tests** - Suite structure and results
- 📁 **Sources** - Test file contents
- 📝 **Logs** - Framework debugging

## Installation

```bash
npm install @wdio/nightwatch-devtools --save-dev
# or
pnpm add -D @wdio/nightwatch-devtools
```

## Usage

Add to your Nightwatch config:

```javascript
// nightwatch.conf.js
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default;

module.exports = {
  src_folders: ['tests'],

  test_settings: {
    default: {
      desiredCapabilities: {
        browserName: 'chrome'
      },
      // Add DevTools globals with lifecycle hooks
      globals: nightwatchDevtools()
    }
  }
}
```

Run your tests:

```bash
nightwatch
```

The DevTools UI will automatically:
1. Start backend server on port 3000
2. Open in a new browser window
3. Stream test data in real-time
4. Stay open after tests finish (close manually to exit)

## Example

See [`example/`](./example) directory for a working sample with:
- Sample test suite
- Nightwatch configuration
- Setup instructions

Run it:
```bash
cd packages/nightwatch-devtools
pnpm build
pnpm example   # Run tests with DevTools UI
```

## How It Works

This is a **thin adapter** (~210 lines) that:

1. ✅ Reuses `@wdio/devtools-backend` - Fastify server + WebSocket
2. ✅ Reuses `@wdio/devtools-app` - Lit-based UI components
3. ✅ Reuses `@wdio/devtools-script` - Browser capture
4. ✅ Adds only Nightwatch lifecycle hooks: `before`, `beforeSuite`, `beforeEach`, `afterEach`, `after`

Same backend, same UI, same capture as WDIO - just different framework hooks!

## Options

```javascript
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default;

module.exports = {
  test_settings: {
    default: {
      globals: nightwatchDevtools({
        port: 3000,           // DevTools server port (default: 3000)
        hostname: 'localhost' // DevTools server hostname (default: 'localhost')
      })
    }
  }
}
```

## What Gets Captured

✅ Test suites and hierarchy
✅ Test pass/fail status
✅ Execution timing
✅ Error messages and stack traces
✅ Browser console logs (automatic)
✅ Network requests (automatic)
✅ DOM mutations (automatic)

Browser-side capture works automatically via `@wdio/devtools-script`.

## Requirements

- **Nightwatch**: >= 3.0.0
- **Node.js**: >= 18.0.0
- **Chrome/Chromium**: For tests and UI

## License

MIT
