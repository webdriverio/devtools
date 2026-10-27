---
'@wdio/nightwatch-devtools': patch
---

On a session without BiDi that requests Chrome's performance log, the plugin reads that log over the WebDriver HTTP transport rather than with `browser.getLog`, so the read no longer joins Nightwatch's command queue and cannot make a test command such as `setValue` or `click` resolve before it has finished.

Every read the plugin makes over that transport (the performance log, the collector drains, the snapshot probes and screenshots) now uses the connection Nightwatch itself is configured with: https when `webdriver.ssl` is set, or when it is unset and the port is 443, and basic auth from `webdriver.username` and `webdriver.access_key`. Against a remote grid on https or behind credentials, those reads previously went out as plain http without credentials and failed.
