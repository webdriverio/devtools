
# @wdio/devtools-service

DevTools is a UI test runner for WebdriverIO. It provides a user interface for running, debugging, and inspecting your browser automation tests, along with advanced features like network interception, performance tracing, and more.

## Installation

Install the service in your project:

```sh
npm install @wdio/devtools-service --save-dev
```

or with pnpm:

```sh
pnpm add -D @wdio/devtools-service
```

## Usage

### WebdriverIO Test Runner

Add the service to your `wdio.conf.ts`:

```js
export const config = {
  // ...
  services: ['devtools'],
  // ...
}
```
