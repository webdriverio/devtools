---
'@wdio/devtools-app': patch
---

The A11y tab reads an accessibility name or a locator that contains `→` whole, where it took the text after the last arrow as the locator. It also keeps a quote inside a name, where it cut the name at the quote, and no longer takes a quoted string inside a locator for the name of a node that has none.
