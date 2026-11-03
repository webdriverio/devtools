---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
'@wdio/devtools-script': minor
'@wdio/devtools-backend': patch
'@wdio/elements': patch
---

Password fields are now masked in the replayed page by default, in live and trace mode alike. The collector replaces the value of every `<input type="password">` with `••••`, a fixed placeholder that hides its length, before it leaves the browser: the DOM anchor, the per-keystroke field-state records and `value` attribute mutations all carry the placeholder, and a field a show-password toggle turned into a text input stays masked. Other fields are recorded as typed, and command rows (the Actions list, the trace's action titles, `transcript.md`) keep the real typed text, password included.

Two options control it: `maskSelectors: ['.account-number']` also masks the text, value and text-bearing attributes (`aria-label`, `title`, `alt`, `placeholder`) of every element a CSS selector matches in the replayed page (the A11y tab and the element list then name it `••••` and never locate it by its text), and `maskInputs: false` turns the password masking off. Masking only changes the replayed page: the typed password is still in its command row, and screenshots, console lines and request bodies are not masked; see the README's "Password masking" section.
