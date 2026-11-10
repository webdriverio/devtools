---
'@wdio/devtools-service': patch
'@wdio/nightwatch-devtools': patch
'@wdio/selenium-devtools': patch
'@wdio/devtools-backend': patch
---

Reject non-2xx WebDriver HTTP probe replies before they are treated as screenshot payloads, and ignore non-string screenshots across action snapshot capture, screencast polling, and trace export so a late screenshot after session teardown never aborts writing the trace zip.
