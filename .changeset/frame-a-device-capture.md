---
"@wdio/devtools-app": minor
---

Frame a capture that came off a device as the device, not as a desktop browser window. A mobile trace rendered inside the desktop chrome — traffic lights, and an address bar reading `unknown`, since a native app has no url — with the phone left as a narrow strip in the middle of a landscape frame. Measured on a 1170x2532 capture: the image used 162 px of a 388 px frame and the remaining ~60% was backdrop.

The frame is now shaped from the capture's own decoded pixels, and its header states the device instead of drawing window furniture that describes nothing. The capture's pixels are the only workable source: the metadata viewport disagrees with the screenshot on both platforms, since Android reports the window without the navigation bar and iOS reports points, so an older binary on an iPhone 17 reports a 390x844 window for a 402x874 screen. The frame's own header and padding are taken off before fitting and added back after, or the capture area comes out short by them and the image letterboxes inside a frame that was supposed to be its shape.

Only the screenshot branch is reframed. A mobile *browser* session — Appium driving Chrome on Android — reports a device and also carries a DOM, and that replay is an iframe laid out at its own captured viewport; shaping the frame to a screenshot as well would fight that sizing for the same box, and such a session is a real browser with a real url, so the browser chrome stays honest there. A desktop capture is untouched.

Reads the `device` field added in #345, and the decoded-size helper added in #344.
