---
'@wdio/devtools-service': minor
---

Capture a native app's network in the Network tab through the appium-interceptor plugin. A native Appium session has no document and no BiDi network events, so its requests were never visible. When the session sets `appium:intercept: true` and Appium runs with `--use-plugins=appium-interceptor`, the service now lists each request the plugin's proxy recorded, with method, URL, status, headers and bodies, in live and trace mode. Without the plugin the session runs as before and a warning is logged.
