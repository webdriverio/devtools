---
'@wdio/devtools-script': patch
---

Serialize the live DOM directly instead of writing it out as HTML and parsing that back. The collector already stands in the document, so the round trip bought nothing and cost a 148 KB HTML parser plus a view library inside a script injected into every page: 92% of the bundle, which drops from 213 KB to 10 KB.

That size was not merely wasteful. The bundle is registered as a BiDi preload, and headed Chrome 154 degrades superlinearly with a preload's size — measured, 50 KB doubled the first navigation and 100 KB never completed — so a run with the service attached could hang outright. Reading the DOM also describes the page the browser actually built rather than what a second parser makes of its markup, which is what `localName` and already-adjusted attribute names give for free.
