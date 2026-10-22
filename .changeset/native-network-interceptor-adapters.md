---
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

Capture a native app's network in the Network tab through the appium-interceptor plugin, as the WebdriverIO service does. When the session's capabilities set `appium:intercept: true` and Appium runs with `--use-plugins=appium-interceptor`, each request the plugin's proxy recorded is listed with method, URL, status, headers and bodies, in live and trace mode, and lands in the per-test trace of the test that made it. A new session, including one that replaces the previous one mid-run, gets its own listener. Without the plugin the session runs as before and a warning is logged.
