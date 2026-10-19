---
'@wdio/devtools-service': patch
---

The config file now reaches a dashboard the service attaches to, and a failed command's row carries the browser's own error message. The `config` frame was sent from `beforeSession` on a capturer with no socket, so it was dropped every run and only a backend the launcher itself started, which inherits the path from the environment, ever learned the file. The row stored the raw `Error`, whose message is non-enumerable, so the live socket received `{}`; it is now serialized, and webdriver's `WebDriverError: <message> when running "<endpoint>" with method "<M>"` decoration is stripped so the Errors tab shows what the browser said, as it does for the other adapters.
