---
'@wdio/nightwatch-devtools': patch
---

Stop the plugin from cutting a test's command short. Half a second after a navigation the plugin reads the page's performance timings, and it did so through Nightwatch's command queue, which attached the read to whichever command the test was running at the time and let that command's `await` return before the command had finished. A login that awaited `setValue` on the password field could then click submit while the password was still being typed. The read now goes to the driver directly.
