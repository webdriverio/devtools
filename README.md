# WebdriverIO DevTools

A powerful browser devtools extension for debugging, visualizing, and controlling WebdriverIO test executions in real-time.

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

### 🔍 Debugging Capabilities
- **Command Logging**: Detailed capture of all WebDriver commands with arguments and results
- **Screenshot Capture**: Automatic screenshots after each command for visual debugging
- **Source Code Mapping**: View the exact line of code that triggered each command
- **Console Logs**: Capture and display application console output
- **Error Tracking**: Full error messages and stack traces for failed tests

### 🎮 Execution Controls
- **Global Test Running State**: All play buttons automatically disable during test execution to prevent conflicts
- **Immediate Feedback**: Spinner icons update instantly when tests start
- **Actions Tab Auto-Clear**: Execution data automatically clears and refreshes on reruns
- **Metadata Tracking**: Test duration, status, and execution timestamps

### 🏗️ Architecture
- **Frontend**: Lit web components with reactive state management (@lit/context)
- **Backend**: Fastify server with WebSocket streaming for real-time updates
- **Service**: WebdriverIO reporter integration with stable UID generation
- **Process Management**: Tree-kill for proper cleanup of spawned processes

## Installation

```bash
npm install @wdio/devtools-service
```

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

## Project Structure

```
packages/
├── app/          # Frontend Lit-based UI application
├── backend/      # Fastify server with test runner management
├── service/      # WebdriverIO service and reporter
└── script/       # Browser-injected trace collection script
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
