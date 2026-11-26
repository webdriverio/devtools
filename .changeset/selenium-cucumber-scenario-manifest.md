---
'@wdio/selenium-devtools': patch
---

The artifacts manifest lists a Selenium Cucumber scenario as the test, not each of its Gherkin steps. A scenario gets its own attempt record and trace ids. Per-test trace zips, screenshots and videos are still written per step, so their `testUids` name step uids that the manifest no longer lists.
