---
patch
---

A `WebDriverWait(...).until(...)` or `until_not(...)` that times out now shows as a failed `wait` row in the Actions list and the Errors tab, named after its condition (for example `presence_of_element_located(('css selector', '#missing'))`), at the line that called it and carrying the `TimeoutException`. Before, the test failed with nothing red in the dashboard and the timeout only in the console. The commands a wait repeats on every poll now fold into one row per call instead of listing a row per poll.
