---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A typed value is now redacted when the adapter could not check whether its field is a password field: the field-type read failed, timed out, or, on Nightwatch, could not be issued because the field is located by neither CSS nor XPath or has no selector. Previously the value was left as typed and the password could reach the dashboard and the trace. The run logs one warning that names no value. Nightwatch's `setPassword` is now taken as a password without reading the field.
