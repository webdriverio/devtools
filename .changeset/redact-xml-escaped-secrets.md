---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Secret redaction also replaces a secret's XML-escaped form, with `&`, `<`, `>` and `"` written as `&amp;`, `&lt;`, `&gt;` and `&quot;`, which is how a native app's page source carries a value in an attribute. `token&1234` in such a source is `token&amp;1234`, and was left in place before.
