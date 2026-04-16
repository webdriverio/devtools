# WebdriverIO DevTools

A powerful browser devtools extension for debugging, visualizing, and controlling test executions in real-time.

Works with **WebdriverIO** and **[Nightwatch.js](./packages/nightwatch-devtools/README.md)** — same backend, same UI, same capture infrastructure.

## Features

### 🎯 Interactive Test Execution
- **Selective Test Rerun**: Click play buttons on individual test cases, test suites, or Cucumber scenario examples to re-execute them instantly
- **Smart Browser Reuse**: Tests rerun in the same browser window without opening new tabs, improving performance and user experience
- **Stop Test Execution**: Terminate running tests with proper process cleanup using the stop button
- **Test List Preservation**: All tests remain visible in the sidebar during reruns, maintaining full context

### 🎭 Multi-Framework Support
- **Mocha**: Full support with grep-based filtering for test/suite execution
- **Jasmine**: Complete integration with grep-based filtering
- **Cucumber**: Scenario-level and example-specific execution with feature:line targeting

### 📊 Real-Time Visualization
- **Live Browser Preview**: View the application under test in a scaled iframe with automatic screenshot updates
- **Actions Timeline**: Command-by-command execution log with timestamps and parameters
- **Test Hierarchy**: Nested test suite and test case tree view with status indicators
- **Live Status Updates**: Immediate spinner icons and visual feedback when tests start/stop

### 🧐 Debugging Capabilities
- **Command Logging**: Detailed capture of all WebDriver commands with arguments and results
- **Screenshot Capture**: Automatic screenshots after each command for visual debugging
- **Source Code Mapping**: View the exact line of code that triggered each command
- **Console Logs**: Capture and display application console output with timestamps and log levels
- **Network Logs**: Monitor and inspect HTTP requests/responses including headers, payloads, timing, and status codes
- **Error Tracking**: Full error messages and stack traces for failed tests

### 🎮 Execution Controls
- **Global Test Running State**: All play buttons automatically disable during test execution to prevent conflicts
- **Immediate Feedback**: Spinner icons update instantly when tests start
- **Actions Tab Auto-Clear**: Execution data automatically clears and refreshes on reruns
- **Metadata Tracking**: Test duration, status, and execution timestamps

### 🎬 Session Screencast
- **Automatic Video Recording**: Captures a continuous `.webm` video of the browser session alongside the existing snapshot and DOM mutation views
- **Cross-Browser**: Uses Chrome DevTools Protocol (CDP) push mode for Chrome/Chromium; automatically falls back to screenshot polling for Firefox, Safari, and other browsers — no configuration change needed
- **Per-Session Videos**: Each browser session (including sessions created by `browser.reloadSession()`) produces its own recording, selectable from a dropdown in the UI
- **Smart Trimming**: Leading blank frames before the first URL navigation are automatically removed so videos start at the first meaningful page action

> For setup, configuration options, and prerequisites see the **[service README](./packages/service/README.md#screencast-recording)**.

### 🔍︎ TestLens
- **Code Intelligence**: View test definitions directly in your editor
- **Run/Debug Actions**: Execute individual tests or suites with inline CodeLens actions
- **Quick Navigation**: Jump between test code and execution results seamlessly
- **Status Indicators**: Visual feedback for test pass/fail states in the editor

### 🏗️ Architecture
- **Frontend**: Lit web components with reactive state management (@lit/context)
- **Backend**: Fastify server with WebSocket streaming for real-time updates
- **Service**: WebdriverIO reporter integration with stable UID generation
- **Process Management**: Tree-kill for proper cleanup of spawned processes

## Demo

### 🛠️ Test Rerunner & Snapshot
<img src="https://github.com/user-attachments/assets/c3804559-c0ec-441a-80dc-e4048385f3b2" alt="Test Rerunner & Snapshot Demo" width="400" />

### 🛑 Stop Test Runner
<img src="https://github.com/user-attachments/assets/f42e43ed-bfac-4280-be5f-87895fb232d3" alt="Stop Test Runner Demo" width="400" />

### 🔍︎ TestLens
<img src="https://github.com/user-attachments/assets/72c576a1-330a-49c4-affe-df260e7c70df" alt="TestLens Demo" width="400" />

### >_ Console Logs
<img src="https://github.com/user-attachments/assets/aff14f15-a298-4a12-bc3d-8e4deefddae6" alt="Console Logs" width="400" />

### 🌐 Network Logs
<img src="https://github.com/user-attachments/assets/2cca4885-f989-4d07-b7ce-a4fa476c3c1c" alt="Network Logs 1" width="400" />

<img src="https://github.com/user-attachments/assets/0f81e0af-75b5-454f-bffb-e40654c89908" alt="Network Logs 2" width="400" />

### 🎬 Session Screencast


## Installation

**WebdriverIO:**
```bash
npm install @wdio/devtools-service
```

**Nightwatch:**
```bash
npm install @wdio/nightwatch-devtools
```

> See the [Nightwatch Integration](#nightwatch-integration) section for configuration details.

## Configuration

Add the service to your `wdio.conf.js`:

```javascript
export const config = {
    // ...
    services: ['devtools']
}
```

## Usage

1. Run your WebdriverIO tests
2. The devtools UI automatically opens in an external browser window at `http://localhost:3000`
3. Tests begin executing immediately with real-time visualization
4. View live browser preview, test progress, and command execution
5. After initial run completes, use play buttons to rerun individual tests or suites
6. Click stop button anytime to terminate running tests
7. Explore actions, metadata, console logs, and source code in the workbench tabs

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run demo
pnpm demo
```

## Nightwatch Integration

Using [Nightwatch.js](https://nightwatchjs.org/)? A dedicated adapter package brings the same DevTools UI to your Nightwatch test suite with zero test code changes.

→ **[`@wdio/nightwatch-devtools`](./packages/nightwatch-devtools/README.md)** — configuration, Cucumber/BDD setup, and limitations.

## Project Structure

```
packages/
├── app/                   # Frontend Lit-based UI application
├── backend/               # Fastify server with test runner management
├── service/               # WebdriverIO service and reporter
├── script/                # Browser-injected trace collection script
└── nightwatch-devtools/   # Nightwatch adapter plugin
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## :page_facing_up: License

[MIT](/LICENSE)
