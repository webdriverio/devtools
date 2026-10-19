---
patch
---

Fix network requests occasionally staying pending in the Network tab when BiDi is capturing them. Selenium delivers each BiDi event on a thread of its own, so a request's response could be sent to the dashboard before the request itself, and the request's pending row then replaced the completed one. A request's events are now sent in order, and a response that arrives before its request is held until the request has been listed. The teardown network summary also counts responses whose request was never seen.
