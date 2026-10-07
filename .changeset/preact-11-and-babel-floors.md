---
'@wdio/devtools-app': patch
'@wdio/devtools-service': patch
'@wdio/devtools-backend': patch
'@wdio/nightwatch-devtools': patch
'@wdio/selenium-devtools': patch
---

Build the dashboard with preact 11, which renders the DOM replay. Raise the `ws` floor to 8.22.0 for every adapter and the backend, and the service's `@babel/traverse` and `@babel/types` floors to 7.29.8. Babel stays on 7: Babel 8 requires Node 22.18 or newer, and the service runs inside WebdriverIO 9 projects that support Node 18.20 and up.
