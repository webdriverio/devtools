# Nightwatch DevTools Plugin - Architecture Documentation

## Overview

The Nightwatch DevTools plugin is a **thin adapter layer** (~490 lines) that integrates Nightwatch with the WebdriverIO DevTools ecosystem. It provides real-time visual debugging capabilities for Nightwatch tests with zero test code changes.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Nightwatch Test Runner                    │
└───────────────────────┬─────────────────────────────────────┘
                        │ Lifecycle Hooks
                        ↓
┌─────────────────────────────────────────────────────────────┐
│          NightwatchDevToolsPlugin (Main Orchestrator)        │
│  ┌────────────┬────────────┬────────────┬─────────────┐     │
│  │ Session    │ Test       │ Suite      │ Browser     │     │
│  │ Capturer   │ Reporter   │ Manager    │ Proxy       │     │
│  └────────────┴────────────┴────────────┴─────────────┘     │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket Protocol
                        ↓
┌─────────────────────────────────────────────────────────────┐
│              @wdio/devtools-backend (Reused)                 │
│              Fastify Server + WebSocket                      │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP/WS
                        ↓
┌─────────────────────────────────────────────────────────────┐
│              @wdio/devtools-app (Reused)                     │
│              Lit-based UI Components                         │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. NightwatchDevToolsPlugin (Main Orchestrator)

**Location:** `src/index.ts`

**Responsibilities:**
- Manages plugin lifecycle through Nightwatch hooks
- Coordinates all sub-components
- Opens DevTools UI in separate browser window
- Handles backend server startup/shutdown

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `before()` | Start DevTools backend server, open UI browser window |
| `beforeEach(browser)` | Initialize session, inject scripts, prepare tests |
| `afterEach(browser)` | Capture trace data, finalize tests |
| `after()` | Keep process alive until UI browser closes, cleanup |

**Key Features:**
- Automatic UI browser window management using WebdriverIO's `remote()` API
- Process lifecycle management (handles Ctrl+C vs natural exit)
- Unique user data directory per instance to avoid conflicts
- Coordinates data flow between all components

**Hook Implementation:**

```javascript
export default function createNightwatchDevTools(options) {
  const plugin = new NightwatchDevToolsPlugin(options)
  
  return {
    asyncHookTimeout: 3600000, // 1 hour - allows UI review
    before: async function() { await plugin.before() },
    beforeEach: async function(browser) { await plugin.beforeEach(browser) },
    afterEach: async function(browser) { await plugin.afterEach(browser) },
    after: async function() { await plugin.after() }
  }
}
```

---

### 2. SessionCapturer

**Location:** `src/session.ts`

**Responsibilities:**
- WebSocket communication with backend
- Capture and stream test execution data in real-time
- Inject browser scripts for runtime capture
- Console log and terminal output interception

**Key Features:**

#### WebSocket Client
- Connects to backend at `ws://hostname:port/worker`
- Sends data upstream to backend in real-time
- Handles connection failures gracefully

#### Script Injection
- Injects `@wdio/devtools-script` into browser pages
- Enables browser-side capture (network, console, mutations)
- Re-injects on page navigation

#### Console Patching
- Intercepts `console.log/info/warn/error`
- Captures test framework logs
- Filters internal framework messages to reduce noise

#### Process Stream Interception
- Captures stdout/stderr from test execution
- Detects log levels from text patterns
- Strips ANSI escape codes for clean display

**Data Captured:**

| Category | Details |
|----------|---------|
| **Commands** | Command name, arguments, results, timestamps, call sources |
| **Console Logs** | Type, arguments, timestamp, source (browser/test/terminal) |
| **Network Requests** | Via injected script in browser |
| **DOM Mutations** | Via MutationObserver in browser |
| **Performance Metrics** | Navigation timing, resource timing |
| **Source Files** | Test file contents for display |

**Key Methods:**

```typescript
class SessionCapturer {
  // Send data to backend
  sendUpstream(type: string, data: any): void
  
  // Inject capture script into browser
  async injectScript(browser: NightwatchBrowser): Promise<void>
  
  // Capture trace data after test
  async captureTrace(browser: NightwatchBrowser): Promise<void>
  
  // Capture source file contents
  async captureSource(filePath: string): Promise<void>
  
  // Wait for WebSocket connection
  async waitForConnection(timeoutMs: number): Promise<boolean>
}
```

---

### 3. TestReporter

**Location:** `src/reporter.ts`

**Responsibilities:**
- Track test and suite lifecycle
- Generate stable UIDs for tests/suites
- Update UI with test status changes
- Extract test metadata from source files

**Key Features:**

#### Stable UID Generation
- Hash-based UIDs using file path + full title
- Consistent across test runs (no random/sequential IDs)
- Prevents duplicate test entries in UI

```typescript
function generateStableUid(item: SuiteStats | TestStats): string {
  const parts = [item.file, item.fullTitle]
  const signature = parts.join('::')
  
  // Hash for stable, short UIDs
  const hash = signature.split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0
  }, 0)
  
  return `stable-${Math.abs(hash).toString(36)}`
}
```

#### Test Metadata Extraction
- Parses test files to extract test names before execution
- Pre-populates suite with pending tests
- Improves UI responsiveness

#### State Management
- Tracks test states: `pending` → `running` → `passed/failed/skipped`
- Updates UI in real-time via callback
- Handles test state transitions

**Key Methods:**

```typescript
class TestReporter {
  // Generate stable UID for test/suite
  generateStableUid(filePath: string, name: string): string
  
  // Suite lifecycle
  onSuiteStart(suiteStats: SuiteStats): void
  onSuiteEnd(suiteStats: SuiteStats): void
  
  // Test lifecycle
  onTestStart(testStats: TestStats): void
  onTestEnd(testStats: TestStats): void
  onTestPass(testStats: TestStats): void
  onTestFail(testStats: TestStats): void
  
  // Query methods
  getCurrentSuite(): SuiteStats | undefined
  updateSuites(): void
}
```

---

### 4. TestManager

**Location:** `src/helpers/testManager.ts`

**Responsibilities:**
- Manage test lifecycle and state transitions
- Detect test boundaries (when tests change)
- Prevent duplicate test reporting
- Finalize incomplete tests

**Key Features:**

#### Test Boundary Detection
Detects when the current test changes by monitoring `browser.currentTest.name`:

```typescript
detectTestBoundary(currentNightwatchTest: any): string {
  const currentTestName = currentNightwatchTest?.name || 'unknown'
  
  // If test name changed, finalize previous test
  if (this.lastKnownTestName && currentTestName !== this.lastKnownTestName) {
    // Finalize previous test with results
    this.finalizePreviousTest()
  }
  
  this.lastKnownTestName = currentTestName
  return currentTestName
}
```

#### Duplicate Prevention
- Tracks processed tests per file using `Map<string, Set<string>>`
- Prevents reporting the same test multiple times
- Handles parallel test execution

#### State Transitions
Manages test state flow:

```
pending → running → passed/failed/skipped
   ↑                       ↓
   └───────────────────────┘
      (reset for next test)
```

**Key Methods:**

```typescript
class TestManager {
  // Update test state and report to UI
  updateTestState(test: TestStats, state: string, endTime?: Date, duration?: number): void
  
  // Find test in suite by title
  findTestInSuite(suite: SuiteStats, testTitle: string): TestStats | undefined
  
  // Mark test as processed (prevent duplicates)
  markTestAsProcessed(testFile: string, testTitle: string): void
  isTestProcessed(testFile: string, testTitle: string): boolean
  
  // Detect when current test changes
  detectTestBoundary(currentNightwatchTest: any): string
  
  // Start pending test on first command
  startTestIfPending(currentTestName: string): void
  
  // Finalize all incomplete tests in suite
  finalizeSuiteTests(suite: SuiteStats, testcases: Record<string, any>): void
}
```

---

### 5. SuiteManager

**Location:** `src/helpers/suiteManager.ts`

**Responsibilities:**
- Create and manage test suites
- Track suite state and completion
- Pre-populate test entries for display

**Key Features:**

#### Suite Creation
- Creates suite on first test encounter for a file
- Generates stable UID for suite
- Pre-populates with pending test entries

```typescript
getOrCreateSuite(testFile: string, suiteTitle: string, fullPath: string, testNames: string[]): SuiteStats {
  if (!this.currentSuiteByFile.has(testFile)) {
    const suiteStats = {
      uid: this.testReporter.generateStableUid(fullPath, suiteTitle),
      title: suiteTitle,
      file: fullPath,
      state: 'pending',
      tests: [], // Pre-populated with test names
      // ... other fields
    }
    
    // Create pending test entries
    for (const testName of testNames) {
      suiteStats.tests.push(createPendingTest(testName))
    }
    
    this.currentSuiteByFile.set(testFile, suiteStats)
    this.testReporter.onSuiteStart(suiteStats)
  }
  
  return this.currentSuiteByFile.get(testFile)
}
```

#### Suite State Tracking
- States: `pending` → `running` → `passed/failed`
- State determined by aggregating test results

#### Result Aggregation
Determines suite result from test results:
- **Passed**: All tests passed
- **Failed**: Any test failed
- **Skipped**: All tests skipped

**Key Methods:**

```typescript
class SuiteManager {
  // Get or create suite for test file
  getOrCreateSuite(testFile: string, suiteTitle: string, fullPath: string, testNames: string[]): SuiteStats
  
  // Get existing suite
  getSuite(testFile: string): SuiteStats | undefined
  
  // Update suite state
  markSuiteAsRunning(suite: SuiteStats): void
  
  // Finalize suite with results
  finalizeSuite(suite: SuiteStats): void
  
  // Get all suites
  getAllSuites(): Map<string, SuiteStats>
}
```

---

### 6. BrowserProxy

**Location:** `src/helpers/browserProxy.ts`

**Responsibilities:**
- Intercept browser commands
- Track command execution
- Wrap `browser.url()` for script injection
- Prevent command duplication

**Key Features:**

#### Method Wrapping
Dynamically wraps all browser methods:

```typescript
wrapBrowserCommands(browser: NightwatchBrowser): void {
  const allMethods = [
    ...Object.keys(browser),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(browser))
  ]
  
  allMethods.forEach(methodName => {
    if (shouldWrapMethod(methodName)) {
      const originalMethod = browser[methodName]
      
      browser[methodName] = (...args) => {
        return this.handleCommandExecution(browser, methodName, originalMethod, args)
      }
    }
  })
}
```

#### Command Stack
- Tracks command execution order
- Associates results with commands
- Handles nested/chained commands

#### Deduplication
Prevents duplicate command capture:
- Generates signature: `command + args + callSource`
- Compares with last command signature
- Skips if duplicate

#### Source Tracking
Captures call location from stack traces:
- Extracts file path and line number
- Shows where command was called from test code
- Improves debugging experience

**Key Methods:**

```typescript
class BrowserProxy {
  // Wrap all browser commands
  wrapBrowserCommands(browser: NightwatchBrowser): void
  
  // Special handling for URL navigation
  wrapUrlMethod(browser: NightwatchBrowser): void
  
  // Handle command execution
  private handleCommandExecution(browser, methodName, originalMethod, args): any
  
  // Capture command result
  private captureCommandResult(methodName, args, result, callSource): void
  
  // Capture command error
  private captureCommandError(methodName, args, error, callSource): void
  
  // Reset tracking for new test
  resetCommandTracking(): void
}
```

---

## Data Flow

### Test Execution Flow

```
1. before() Hook (Global - Once)
   ├─ Start @wdio/devtools-backend server
   ├─ Open DevTools UI in Chrome window (separate session)
   └─ Wait for UI connection (10 seconds)

2. beforeEach() Hook (Per Test)
   ├─ Initialize SessionCapturer (first test only)
   │  └─ Connect WebSocket to backend
   ├─ Create/Get Suite via SuiteManager
   │  ├─ Extract test names from source file
   │  └─ Pre-populate with pending tests
   ├─ Find next pending test
   ├─ Start test (mark as running)
   ├─ Wrap browser commands via BrowserProxy
   ├─ Wrap browser.url() for script injection
   └─ Reset command tracking

3. Test Execution
   ├─ Browser commands intercepted by BrowserProxy
   │  ├─ Detect test boundaries via TestManager
   │  ├─ Start pending test on first command
   │  └─ Capture command + args + result
   ├─ Commands captured by SessionCapturer
   ├─ Data streamed to backend via WebSocket
   ├─ Backend broadcasts to UI clients
   └─ UI updates in real-time

4. afterEach() Hook (Per Test)
   ├─ Read Nightwatch test results
   ├─ Finalize current test via TestManager
   │  └─ Update state (passed/failed/skipped)
   ├─ Capture trace data via SessionCapturer
   │  ├─ Network requests (from browser)
   │  ├─ Console logs (from browser)
   │  ├─ DOM mutations (from browser)
   │  └─ Performance metrics (from browser)
   ├─ Check if all tests in suite completed
   └─ Finalize suite if complete

5. after() Hook (Global - Once)
   ├─ Finalize all incomplete suites
   ├─ Send final data to UI
   ├─ Display message: "Close browser to exit"
   ├─ Poll UI browser until closed
   │  ├─ If browser closed: cleanup and exit
   │  └─ If Ctrl+C: exit immediately, keep browser open
   ├─ Delete browser session (if closed naturally)
   └─ Stop backend server
```

### Data Streaming Flow

```
Test Code → BrowserProxy → SessionCapturer → WebSocket → Backend → UI

Example: browser.click('#submit')
   ↓
BrowserProxy intercepts click()
   ↓
Captures: { command: 'click', args: ['#submit'], timestamp, callSource }
   ↓
SessionCapturer adds to commandsLog
   ↓
sendUpstream('commands', [commandLog])
   ↓
WebSocket sends to backend
   ↓
Backend broadcasts to UI clients
   ↓
UI updates Commands panel
```

---

## Nightwatch Lifecycle Hooks

The plugin implements **4 standard Nightwatch hooks**:

| Hook | Timing | Frequency | Purpose |
|------|--------|-----------|---------|
| `before()` | Before all tests | Once | Start backend, open UI |
| `beforeEach(browser)` | Before each test | Per test | Initialize session, start test |
| `afterEach(browser)` | After each test | Per test | Capture data, finalize test |
| `after()` | After all tests | Once | Wait for UI close, cleanup |

**Special Configuration:**
- `asyncHookTimeout: 3600000` (1 hour) - Allows user to review UI after tests complete
- Hooks can be async and return promises

---

## Key Design Patterns

### 1. Reuse over Rebuild

**Philosophy:** Don't reinvent the wheel, adapt existing infrastructure.

**What's Reused:**
- `@wdio/devtools-backend` - Fastify server + WebSocket (100% reused)
- `@wdio/devtools-app` - Lit-based UI components (100% reused)
- `@wdio/devtools-script` - Browser-side capture (100% reused)

**What's New:**
- Nightwatch lifecycle hook integration (~490 lines)
- Test/suite state management
- Command interception for Nightwatch API

**Benefits:**
- Minimal maintenance burden
- Proven, battle-tested infrastructure
- Same UI/UX across WDIO and Nightwatch
- Future improvements benefit both ecosystems

---

### 2. Component Isolation

**Principle:** Each component has a single, well-defined responsibility.

**Benefits:**
- Testable in isolation
- Easy to understand and modify
- Clear interfaces between components
- Reduced coupling

**Example:**
```
TestManager: Test lifecycle only
SuiteManager: Suite lifecycle only
BrowserProxy: Command interception only
SessionCapturer: Data capture and transmission only
```

---

### 3. Stable Identifiers

**Problem:** Random/sequential IDs cause UI flickering and duplicate entries.

**Solution:** Hash-based UIDs using stable identifiers (file + title).

```typescript
generateStableUid(filePath: string, name: string): string {
  const signature = `${filePath}::${name}`
  const hash = signature.split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0
  }, 0)
  return `stable-${Math.abs(hash).toString(36)}`
}
```

**Benefits:**
- Same UID across runs (consistent)
- No duplicate test entries in UI
- Proper updates (not additions) when test status changes

---

### 4. Real-time Streaming

**Architecture:** Push-based data flow via WebSocket.

**Flow:**
```
Capture → Stream → Display
(immediate)  (real-time)  (live updates)
```

**Benefits:**
- See tests as they execute
- No need to wait for completion
- Early detection of issues
- Better debugging experience

---

### 5. Graceful Degradation

**Philosophy:** Failures in capture should not break tests.

**Examples:**
- WebSocket connection fails → Log warning, continue without UI
- Script injection fails → Log error, continue without browser capture
- Backend start fails → Throw error (fatal, cannot proceed)
- UI browser fails → Log error, show manual URL, continue

**Implementation:**
```typescript
try {
  await this.sessionCapturer.injectScript(browser)
} catch (err) {
  log.error(`Failed to inject script: ${err.message}`)
  // Continue test execution
}
```

---

## Configuration

### Plugin Configuration

**Minimal:**
```javascript
// nightwatch.conf.js
module.exports = {
  plugins: ['@wdio/nightwatch-devtools']
}
```

**With Options:**
```javascript
module.exports = {
  plugins: [
    ['@wdio/nightwatch-devtools', {
      port: 3000,           // DevTools server port (default: 3000)
      hostname: 'localhost' // DevTools server hostname (default: localhost)
    }]
  ]
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Port for DevTools backend server |
| `hostname` | `string` | `'localhost'` | Hostname for DevTools backend server |

---

## Browser-Side Capture

The plugin injects `@wdio/devtools-script` into browser pages, which automatically captures:

### Network Requests
- **Method:** Performance API + Fetch/XHR interception
- **Data:** URL, method, status, headers, timing, body (optional)
- **Storage:** Sent to backend via postMessage → WebSocket

### DOM Mutations
- **Method:** MutationObserver API
- **Data:** Added/removed/modified nodes
- **Filtering:** Ignores internal DevTools changes

### Console Logs
- **Method:** Patch console methods (log, info, warn, error)
- **Data:** Type, arguments, timestamp
- **Original:** Calls original console method (non-invasive)

### Performance Metrics
- **Navigation Timing:** DNS, TCP, request, response, DOM load, page load
- **Resource Timing:** Per-resource duration, size, type
- **Data:** Available in command logs for navigation commands

### Injection Points

1. **After `browser.url()` navigation**
   ```typescript
   browser.url = function(url) {
     const result = originalUrl(url)
     result.perform(async function() {
       await sessionCapturer.injectScript(this)
     })
     return result
   }
   ```

2. **Automatic re-injection** on page transitions (clicks, form submits)

---

## Key Metrics Captured

### Test Metrics
| Metric | Source | When |
|--------|--------|------|
| Test title | Nightwatch currentTest | beforeEach |
| Test status | Nightwatch testcases | afterEach |
| Test duration | Nightwatch testcase.time | afterEach |
| Test errors | Nightwatch testcases | afterEach |
| Stack traces | Nightwatch error objects | afterEach |

### Command Metrics
| Metric | Source | When |
|--------|--------|------|
| Command name | Browser method name | During execution |
| Arguments | Method arguments | Before execution |
| Result | Method return value | After execution |
| Timestamp | Date.now() | During execution |
| Call source | Stack trace | During execution |
| Screenshot | Browser screenshot | After page transitions |

### Network Metrics
| Metric | Source | When |
|--------|--------|------|
| Request URL | Performance API | During request |
| Request method | Fetch/XHR interception | During request |
| Response status | Fetch/XHR response | After response |
| Headers | Request/Response objects | During/After request |
| Timing | Performance API | After response |
| Body | Fetch/XHR (optional) | During/After request |

### Performance Metrics
| Metric | Source | When |
|--------|--------|------|
| Page load time | Navigation Timing API | After page load |
| DOM ready time | Navigation Timing API | After DOM ready |
| Resource timings | Resource Timing API | After resource load |
| DNS lookup time | Navigation Timing API | After page load |
| TCP connection time | Navigation Timing API | After page load |

---

## Error Handling

### Error Categories

#### 1. Fatal Errors (Stop Execution)
- **Backend start failure:** Cannot proceed without backend
- **Plugin initialization failure:** Cannot proceed without plugin

```typescript
async before() {
  try {
    const { server, port } = await start(this.options)
  } catch (err) {
    log.error(`Failed to start backend: ${err.message}`)
    throw err // Fatal - stop execution
  }
}
```

#### 2. Non-Fatal Errors (Log and Continue)
- **UI browser failure:** User can open manually
- **WebSocket connection failure:** Continues without UI updates
- **Script injection failure:** Continues without browser capture
- **Command capture errors:** Isolated per command

```typescript
try {
  this.#devtoolsBrowser = await remote({ ... })
} catch (err) {
  log.error(`Failed to open DevTools UI: ${err.message}`)
  log.info(`Please manually open: ${url}`)
  // Continue execution
}
```

### Error Recovery

#### WebSocket Reconnection
- Currently: No automatic reconnection
- Logs error once, continues without streaming
- Future: Could implement exponential backoff retry

#### Script Injection Retry
- Retries on next `browser.url()` call
- No explicit retry logic (relies on page navigation)
- Errors logged but don't block test execution

#### Command Capture Isolation
- Each command wrapped in try-catch
- Errors in one command don't affect others
- Test execution continues normally

---

## Process Lifecycle Management

### Normal Exit (Browser Closed)

```
Tests Complete
   ↓
Display message: "Close browser to exit"
   ↓
Poll UI browser every 1 second
   ↓
Browser window closed by user
   ↓
Detect closure (getTitle() throws)
   ↓
Delete browser session
   ↓
Stop backend server
   ↓
Process exits cleanly
```

**Code:**
```typescript
while (true) {
  try {
    await this.#devtoolsBrowser.getTitle()
    await new Promise(res => setTimeout(res, 1000))
  } catch {
    log.info('Browser window closed, stopping DevTools')
    break
  }
}
```

### Ctrl+C Exit (Force Quit)

```
Tests Running/Complete
   ↓
User presses Ctrl+C
   ↓
SIGINT handler triggered
   ↓
exitBySignal = true
   ↓
Process exits immediately
   ↓
Browser window remains open
   ↓
Backend continues running
```

**Code:**
```typescript
const signalHandler = () => {
  exitBySignal = true
  log.info('Exiting... Browser window will remain open')
  process.exit(0)
}
process.once('SIGINT', signalHandler)
process.once('SIGTERM', signalHandler)
```

**Benefits:**
- Allows inspection of UI after force quit
- User has choice: graceful or force exit
- Backend survives for post-mortem debugging

---

## Multi-Worker Support

### Challenge
Nightwatch can run tests in parallel using multiple browser sessions (workers).

### Solution
Detect session changes and reinitialize:

```typescript
async beforeEach(browser: NightwatchBrowser) {
  const currentSessionId = browser.sessionId
  
  // Check if browser session changed (parallel workers)
  if (currentSessionId && this.#lastSessionId && 
      currentSessionId !== this.#lastSessionId) {
    log.info('Browser session changed - reinitializing for new worker')
    this.isScriptInjected = false
    this.sessionCapturer = null // Reset for new session
  }
  
  this.#lastSessionId = currentSessionId
  
  // Initialize for first test OR new session
  if (!this.sessionCapturer) {
    this.sessionCapturer = new SessionCapturer(...)
    // ... initialize other components
  }
}
```

### Features
- Automatic detection via `sessionId` comparison
- Per-worker state isolation
- Prevents cross-worker contamination
- Handles worker restarts gracefully

---

## Dependencies

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@wdio/devtools-backend` | workspace:* | Server infrastructure (Fastify + WebSocket) |
| `@wdio/logger` | ^9.6.0 | Logging framework |
| `webdriverio` | ^9.18.0 | Browser automation (for opening UI) |
| `ws` | ^8.18.3 | WebSocket client |
| `import-meta-resolve` | ^4.2.0 | Module resolution |
| `stacktrace-parser` | ^0.1.10 | Parse stack traces for call sources |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `nightwatch` | ^3.0.0 | Peer dependency (test framework) |
| `chromedriver` | ^133.0.0 | Chrome automation driver |
| `typescript` | ^5.9.2 | Type checking and compilation |
| `@types/node` | ^22.10.5 | Node.js type definitions |
| `@types/ws` | ^8.18.1 | WebSocket type definitions |

### Peer Dependencies

```json
{
  "peerDependencies": {
    "nightwatch": ">=3.0.0"
  }
}
```

---

## Constants

### Location
`src/constants.ts`

### Categories

#### Page Transition Commands
Commands that trigger page navigation:
```typescript
export const PAGE_TRANSITION_COMMANDS = [
  'url', 'navigateTo', 'click', 'submitForm'
]
```

#### Internal Commands to Ignore
Nightwatch helper commands not relevant to users:
```typescript
export const INTERNAL_COMMANDS_TO_IGNORE = [
  'isAppiumClient', 'isSafari', 'isChrome', 'isFirefox',
  'session', 'timeouts', 'execute', 'executeAsync', ...
]
```

#### Timing Constants (milliseconds)
```typescript
export const TIMING = {
  UI_RENDER_DELAY: 150,           // Delay for UI to render updates
  TEST_START_DELAY: 100,          // Delay before starting test
  SUITE_COMPLETE_DELAY: 200,      // Delay after suite completion
  UI_CONNECTION_WAIT: 10000,      // Wait for UI to connect (10s)
  BROWSER_CLOSE_WAIT: 2000,       // Wait before browser close
  INITIAL_CONNECTION_WAIT: 500,   // Initial WebSocket connection wait
  BROWSER_POLL_INTERVAL: 1000     // Polling interval for browser status
}
```

#### Test States
```typescript
export const TEST_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
}
```

#### Log Sources
```typescript
export const LOG_SOURCES = {
  BROWSER: 'browser',    // From browser console
  TEST: 'test',          // From test code
  TERMINAL: 'terminal'   // From terminal output
}
```

---

## Type System

### Location
`src/types.ts`

### Key Types

#### TestStats
```typescript
interface TestStats {
  uid: string                    // Stable unique identifier
  cid: string                    // Capability ID
  title: string                  // Test name
  fullTitle: string              // Full path: "Suite > Test"
  parent: string                 // Parent suite UID
  state: 'passed' | 'failed' | 'skipped' | 'pending' | 'running'
  start: Date                    // Start timestamp
  end: Date | null               // End timestamp
  type: 'test'                   // Type discriminator
  file: string                   // Test file path
  retries: number                // Number of retries
  _duration: number              // Duration in milliseconds
  error?: Error                  // Error object if failed
  hooks?: any[]                  // Before/after hooks
}
```

#### SuiteStats
```typescript
interface SuiteStats {
  uid: string                    // Stable unique identifier
  cid: string                    // Capability ID
  title: string                  // Suite name
  fullTitle: string              // Full path
  type: 'suite'                  // Type discriminator
  file: string                   // Test file path
  start: Date                    // Start timestamp
  state?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  end?: Date | null              // End timestamp
  tests: (string | TestStats)[]  // Child tests
  suites: SuiteStats[]           // Child suites
  hooks: any[]                   // Before/after hooks
  _duration: number              // Duration in milliseconds
}
```

#### CommandLog
```typescript
interface CommandLog {
  command: string                // Command name (e.g., 'click')
  args: any[]                    // Command arguments
  result?: any                   // Command result
  error?: Error                  // Error if command failed
  timestamp: number              // Execution timestamp
  callSource?: string            // Source location (file:line)
  screenshot?: string            // Screenshot (base64)
  testUid?: string               // Associated test UID
  performance?: PerformanceData  // Performance metrics
  cookies?: string               // Cookies (JSON)
  documentInfo?: DocumentInfo    // Document metadata
}
```

#### NetworkRequest
```typescript
interface NetworkRequest {
  id: string                     // Request ID
  url: string                    // Request URL
  method: string                 // HTTP method
  headers?: Record<string, string>
  status?: number                // Response status
  statusText?: string            // Response status text
  timestamp: number              // Request timestamp
  startTime: number              // Request start time
  endTime?: number               // Request end time
  time?: number                  // Total duration
  type: string                   // Resource type
  response?: {
    fromCache: boolean
    headers: Record<string, string>
    mimeType: string
    status: number
  }
  error?: string                 // Error message
  size?: number                  // Response size
}
```

---

## File Structure

```
packages/nightwatch-devtools/
├── src/
│   ├── index.ts              # Main plugin class (490 lines)
│   ├── session.ts            # SessionCapturer (574 lines)
│   ├── reporter.ts           # TestReporter (290 lines)
│   ├── types.ts              # Type definitions (180 lines)
│   ├── constants.ts          # Constants (100 lines)
│   └── helpers/
│       ├── browserProxy.ts   # BrowserProxy (263 lines)
│       ├── testManager.ts    # TestManager (150 lines)
│       ├── suiteManager.ts   # SuiteManager (120 lines)
│       ├── capturePerformance.ts  # Performance capture script
│       └── utils.ts          # Utility functions
├── example/
│   ├── nightwatch.conf.cjs   # Example configuration
│   ├── tests/
│   │   ├── login.test.js     # Sample test
│   │   └── sample.test.js    # Sample test
│   └── validate.cjs          # Plugin validation script
├── package.json              # Package configuration
├── tsconfig.json             # TypeScript configuration
├── README.md                 # User documentation
└── ARCHITECTURE.md           # This file
```

**Total Lines of Code:** ~2,167 lines (excluding dependencies)

**Plugin Core:** ~490 lines (main orchestrator)

---

## Testing Strategy

### Manual Testing
```bash
cd packages/nightwatch-devtools
pnpm build                    # Compile TypeScript
pnpm validate                 # Validate plugin structure
pnpm example                  # Run example tests
```

### Validation Checklist
- ✅ Plugin compiled (dist/ exists)
- ✅ Plugin module loaded
- ✅ Plugin exports default function
- ✅ Plugin can be instantiated
- ✅ All required lifecycle methods present
- ✅ Backend server starts
- ✅ UI browser opens
- ✅ Tests execute successfully
- ✅ UI updates in real-time
- ✅ Process exits cleanly

### Future Testing
- Unit tests for individual components
- Integration tests for data flow
- E2E tests for full plugin lifecycle
- Performance tests for large test suites

---

## Performance Considerations

### Overhead
- **Command interception:** Minimal (<1ms per command)
- **WebSocket streaming:** Asynchronous, non-blocking
- **Browser script injection:** One-time per page load
- **UI browser:** Separate process, doesn't affect tests

### Optimization Strategies
- **Lazy initialization:** Components created on first use
- **Efficient UIDs:** Hash-based, no string concatenation
- **Minimal serialization:** Only serialize when needed
- **Filtered logging:** Ignore internal framework logs
- **Debouncing:** UI updates debounced to reduce noise

### Scalability
- **Large test suites:** Linear scaling with number of tests
- **Parallel execution:** Per-worker state isolation
- **Memory usage:** Bounded by test suite size
- **Network usage:** WebSocket compression recommended (future)

---

## Future Enhancements

### Short Term
- [ ] Add unit tests for core components
- [ ] Improve error messages and debugging info
- [ ] Add configuration for capture verbosity
- [ ] Support custom logger configuration

### Medium Term
- [ ] WebSocket reconnection logic
- [ ] Performance profiling integration
- [ ] Screenshot capture on test failure
- [ ] Video recording support

### Long Term
- [ ] Multi-browser support (Firefox, Safari)
- [ ] Remote execution support (Selenium Grid)
- [ ] Advanced filtering and search in UI
- [ ] Test replay functionality
- [ ] Integration with CI/CD platforms

---

## Known Limitations

### Current Limitations
1. **Chrome Only:** UI browser currently Chrome-only (uses DevTools protocol)
2. **No Automatic Reconnection:** WebSocket doesn't reconnect on failure
3. **Single Backend:** One backend per test run (no multi-runner support yet)
4. **Console Patching:** Currently disabled to prevent infinite loops
5. **Stream Interception:** Currently disabled to prevent performance issues

### Workarounds
1. **Manual UI Opening:** If UI browser fails, user can open URL manually
2. **Restart on Disconnect:** Restart test run if WebSocket disconnects
3. **Sequential Runs:** Run tests sequentially if parallel causes issues
4. **Direct Logging:** Use `console.log` in tests if needed (captured in terminal)

---

## Troubleshooting

### Common Issues

#### 1. Backend Fails to Start
**Symptom:** Error message "Failed to start backend"

**Causes:**
- Port already in use
- Insufficient permissions
- Node.js version too old

**Solutions:**
- Change port in plugin options
- Kill process using port: `lsof -ti:3000 | xargs kill`
- Update Node.js to >= 18.0.0

#### 2. UI Browser Doesn't Open
**Symptom:** Warning "Failed to open DevTools UI"

**Causes:**
- Chrome/Chromium not installed
- WebDriver issue
- User data directory conflict

**Solutions:**
- Install Chrome/Chromium
- Manually open URL shown in terminal
- Clear temporary directories

#### 3. No Data in UI
**Symptom:** UI opens but shows no tests/commands

**Causes:**
- WebSocket connection failed
- Script injection failed
- Test completed too quickly

**Solutions:**
- Check browser console for errors
- Increase connection wait time
- Add delays in test for verification

#### 4. Tests Hang
**Symptom:** Tests don't complete, process doesn't exit

**Causes:**
- Async hook timeout too short
- Backend server stuck
- Browser process stuck

**Solutions:**
- Increase `asyncHookTimeout`
- Force kill with Ctrl+C
- Check browser DevTools for errors

---

## Contributing

### Development Setup
```bash
# Clone repository
git clone https://github.com/webdriverio/devtools.git
cd devtools

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Navigate to Nightwatch plugin
cd packages/nightwatch-devtools

# Build plugin
pnpm build

# Run example
pnpm example
```

### Code Style
- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting
- JSDoc comments for public APIs

### Testing
- Add tests for new features
- Ensure existing tests pass
- Test with real Nightwatch projects
- Verify UI updates correctly

---

## References

### Documentation
- [Nightwatch Plugin API](https://nightwatchjs.org/guide/extending-nightwatch/adding-plugins.html)
- [WebdriverIO DevTools](https://webdriver.io/docs/devtools-service)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

### Related Packages
- [@wdio/devtools-backend](../backend/) - Backend server
- [@wdio/devtools-app](../app/) - UI components
- [@wdio/devtools-script](../script/) - Browser capture
- [@wdio/devtools-service](../service/) - WDIO service (reference implementation)

---

## License

MIT License - See [LICENSE](../../LICENSE) file for details.

---

## Maintainers

WebdriverIO Team
- Repository: https://github.com/webdriverio/devtools
- Issues: https://github.com/webdriverio/devtools/issues
- Pull Request: https://github.com/webdriverio/devtools/pull/156

---

**Last Updated:** February 18, 2026
