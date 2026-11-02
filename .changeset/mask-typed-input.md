---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
'@wdio/devtools-script': minor
'@wdio/devtools-backend': patch
'@wdio/elements': patch
---

Text typed into the page is now masked by default, in live and trace mode alike. Every value typed into a text-like `<input>` (password included) or a `<textarea>`, and the text of an editable region (`contenteditable`, `role="textbox"`), is replaced by `••••`, a fixed placeholder that hides its length, before it leaves the browser: the DOM anchor, the per-keystroke field-state records and `value` attribute mutations all carry the placeholder. The adapters mask the typed arguments of input commands (WebdriverIO `setValue`/`addValue`/`keys`/`sendAlertText`/key actions, Selenium `sendKeys`, Nightwatch `setValue`/`sendKeys`/`updateValue`/`setPassword`/`keys`/`setAlertText`), so the Actions list, the trace's action titles and `transcript.md` show `••••`, and they scrub a typed value wherever it comes back: a value read, an assertion operand or message, a failed test's error, a captured log line, the browser console, a request or response body.

Two options control it: `maskSelectors: ['.account-number']` also masks the text and value of every element a CSS selector matches (the A11y tab and the element list then name it `••••` and never locate it by its text), and `maskInputs: false` restores full capture. Screenshots and the screencast are not masked, nor is a credential written as a literal in the test source; see the README's "Typed input masking" section for the full list.
