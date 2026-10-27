---
'@wdio/selenium-devtools': patch
---

A `driver.wait()` that times out or rejects now shows as a failed `wait` row named after its condition (for example `Waiting for element to be located By(css selector, h1)`), in the Actions list, the Errors tab and the trace, in place of the row its polls folded into. A passing wait renders as before, and the wait's promise rejects, or goes unhandled, exactly as selenium's own does. A wait's polls now fold only into a row of that same wait: the polls fired from its timer join its first poll's row instead of listing as a second one, they never fold into an earlier, unrelated row with the same command and arguments, and two reads inside one condition (say `a.getText()` and `b.getText()`) each keep a row of their own.
