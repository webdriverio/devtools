---
"@wdio/devtools-script": patch
---

Stop the trace player from stacking a page on top of itself. Every record in a `MutationObserver` batch is serialized at CALLBACK time, so a `childList` record's subtree is captured with all the descendants the same batch went on to insert — while those insertions still carry records of their own. Replaying both grafted the same content in once per nesting level. The HTML parser fills a document in a single batch, so a document-start collector saw the whole page as one nested chain: measured on the example runs, the Selenium trace replayed 7 username inputs, 7 password inputs and 4 copies of the form, and the WDIO trace duplicated the password field, with the wrong DOM showing at 67 of 138 and 65 of 82 selectable indices. Records already covered by another record's payload are now dropped, which takes both to 0.
