# Nightwatch DevTools Example

This example demonstrates the `@wdio/nightwatch-devtools` plugin in action.

## Prerequisites

Make sure you have Chrome/Chromium installed on your system. The example uses Nightwatch's built-in chromedriver manager.

## Setup

1. Build the plugin:
```bash
cd packages/nightwatch-devtools
pnpm build
```

2. Install dependencies:
```bash
pnpm install
```

## Running the Example

### Option 1: Automatic (Recommended)

Run the example tests with DevTools UI:

```bash
pnpm example
```

### Option 2: Manual Setup

If you encounter chromedriver issues, you can:

1. **Install chromedriver globally:**
```bash
npm install -g chromedriver
```

2. **Or download Chrome for Testing:**
Visit: https://googlechromelabs.github.io/chrome-for-testing/

3. **Update nightwatch.conf.cjs** with your chromedriver path:
```javascript
webdriver: {
  start_process: true,
  server_path: '/path/to/chromedriver',
  port: 9515
}
```

## What Happens

When you run the example, the plugin will:

1. ✅ Start the DevTools backend server on port 3000
2. ✅ Open the DevTools UI in a new browser window
3. ✅ Run your Nightwatch tests
4. ✅ Stream all commands, logs, and results to the UI in real-time
5. ✅ Keep the UI open until you close the browser window

## What You'll See in the DevTools UI

- **Commands Tab**: Every Nightwatch command executed (url, click, assert, etc.)
- **Console Tab**: Browser console logs
- **Network Tab**: All HTTP requests made during tests
- **Tests Tab**: Test suite structure and results (pass/fail)
- **Metadata Tab**: Session information and test timing
- **Sources Tab**: Test file sources
- **Logs Tab**: Framework logs and debugging information

## Zero Test Changes Required

Notice the test files in `example/tests/` have **zero DevTools-specific code**. They're pure Nightwatch tests. The plugin automatically:
- Hooks into Nightwatch's lifecycle
- Captures all test data
- Sends it to the DevTools backend
- Updates the UI in real-time

## Configuration

### Minimal (Default)

```javascript
// nightwatch.conf.cjs
module.exports = {
  plugins: ['@wdio/nightwatch-devtools']
}
```

### Custom Port

```javascript
module.exports = {
  plugins: [
    ['@wdio/nightwatch-devtools', {
      port: 4000,
      hostname: 'localhost'
    }]
  ]
}
```

## Troubleshooting

### "Failed to connect to ChromeDriver"

Make sure chromedriver is installed:
```bash
pnpm install chromedriver
# Then rebuild it
pnpm rebuild chromedriver
```

Or install globally:
```bash
npm install -g chromedriver
```

### "Module not found"

Make sure you've built the plugin:
```bash
pnpm build
```

### Port Already in Use

Change the port in your config:
```javascript
plugins: [
  ['@wdio/nightwatch-devtools', { port: 4000 }]
]
```
