---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
'@wdio/devtools-backend': patch
---

Typed passwords and credentials are now redacted by default. Before a test types into an `<input type="password">` (WebdriverIO `setValue` / `addValue`, Selenium `sendKeys`, Nightwatch `setValue` / `setPassword` / `sendKeys` / `updateValue`), the adapter reads the field's type, one driver round trip capped at 2 s, and for a password field replaces the typed value with `••••`, a fixed placeholder that hides its length, in the row that types it and in everything sent or written after it: command rows, results and errors, `transcript.md`, console lines and captured stdout, network URLs, headers and bodies, the DOM and its mutations, the element and accessibility captures, the test source and the suite tree. The values of `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` in every network row and the trace's HAR are replaced too, keeping the header names, as are the cookie values a navigation row records and the `value` of every cookie a command returns. All of it follows `maskInputs`: `maskInputs: false` turns it off with the page masking.

New `secrets` option for any other value, redacted from the start of the run:

```ts
secrets: ['SuperSecretPassword!', { env: 'LOGIN_PASSWORD' }]
```

A string is the value; `{ env: 'NAME' }` reads it from that environment variable when the adapter starts. A value shorter than 4 characters, or an unset variable, is skipped, and one warning gives the count of skipped entries, never a value or a variable name. A value inside a longer string is replaced, as are its JSON-escaped, URL-encoded and form-encoded forms; a prefix of a value is not, since the page already masks a password field's own keystrokes. A secret on a JavaScript runner's command line reaches the dashboard's Run-all and Rerun commands as `••••`; pass it through an environment variable. Not redacted: screenshots and the screencast (pixels), base64 data such as an image, keys sent with no target element, a value typed into a field that is not a password field unless it is listed, and frames a live dashboard received before the password was typed (the test source, the login page's text); see the README's "Secret redaction" section.
