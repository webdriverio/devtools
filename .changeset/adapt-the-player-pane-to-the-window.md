---
"@wdio/devtools-app": patch
---

Adapt the player pane to the window it is actually in. The pane's height came from a pixel number resolved once, at construction, from whatever window happened to be open then, and nothing recomputed it: measured at 124px in a 1280x720 window and still 124px at 2560x1440, so a trace rendered into a 13px-wide box on a 2560px screen. Not mobile-specific — wrong for every trace, just least visible on a desktop one.

Three separate things froze it, and all three had to go. `MIN_WORKBENCH_HEIGHT` was `Math.min(300, window.innerHeight * 0.3)` evaluated at module import, so it took the window open at page load and — being the pane's own `minPosition` — pinned the pane there for the life of the page; loaded in a 413px-tall window it is exactly the 124px measured. `DragController.initialPosition` took a number rather than the getter its bounds already accepted, so a window-derived default could never follow the window. And each controller registered its resize handling by assigning `window.onresize`, which is a single slot: with five controllers on the page only the last one constructed ever adjusted, and it clobbered anything else on that slot.

A height the user dragged still wins. It is stored, and a resize only re-clamps it — so it survives a window that still has room for it and is pulled back inside one that no longer does, rather than leaving the drag handle off-screen.

The player component also re-fitted only on `resize` and `window-drag`, which meant it depended on whoever changed the layout remembering to announce it — and the dock divider, the sidebar collapsing and browser zoom announce nothing. It now watches its own box with a `ResizeObserver`, which covers all of them.
