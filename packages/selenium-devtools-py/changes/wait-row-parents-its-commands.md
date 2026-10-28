---
patch
---

Every `WebDriverWait(...).until(...)` and `until_not(...)` is now one row in the Actions list, passing or not, and the commands its condition issued are nested under it, collapsed until you open the row (it opens on its own when the wait timed out). The row appears as soon as the wait starts and is updated when it ends, carrying the `TimeoutException` when it timed out. A wait on `EC.presence_of_element_located(locator)` is named `waitForElementLocated` and one on `EC.visibility_of_element_located(locator)` `waitForElementVisible`, each on the same selector as the element rows its polls make, so the trace player shows them as the element waits they are; any other condition is a `wait` row named after the condition, `until_not` with a `not ` prefix. Before, a passing wait had no row of its own, and a timed-out one replaced the row of its last poll.
