---
minor
---

Capture a native app's network requests on Appium, through the [appium-interceptor](https://github.com/AppiumTestDistribution/appium-interceptor-plugin) plugin. A native app has no document and Appium serves no BiDi network events, so the Network tab of a native session was always empty. When Appium runs with `--use-plugins=appium-interceptor` and the session sets `appium:intercept: True`, the adapter starts a listener on the plugin's proxy and lists what it recorded after every command, when each test reports its outcome, and when the driver quits. Each request carries its method, URL, status, headers and bodies; the plugin records no timing, so a request is placed when it was first read. Without the plugin the adapter logs a warning and the session runs as usual. The plugin supports Android.
