---
'@wdio/nightwatch-devtools': patch
---

On a session without BiDi that requests Chrome's performance log, the plugin reads that log over the WebDriver HTTP transport rather than with `browser.getLog`, so the read no longer joins Nightwatch's command queue and cannot make a test command such as `setValue` or `click` resolve before it has finished.
