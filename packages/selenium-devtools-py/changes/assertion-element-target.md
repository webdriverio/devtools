---
patch
---

An assertion row now names the element its value was read from, so the dashboard boxes that element when the row is selected: `assert heading.text == "Secure Area"` carries the locator `heading` was found by. This works for values read with `.text`, `get_attribute`, `is_displayed` and the other element reads, in pytest runs and in plain scripts. A value read from the page itself, such as `driver.title` or `driver.current_url`, names no element, even when an element's text reads the same.
