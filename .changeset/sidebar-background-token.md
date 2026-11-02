---
'@wdio/devtools-app': patch
---

Elements styled with the sidebar background now get it: `bg-sideBarBackground` named a colour the app's Tailwind theme did not define, so no CSS was generated and those elements showed whatever sat behind them. Most visibly, the start screen showed light text on a white page in dark mode. The same fix applies to `text-descriptionForeground`, `text-disabledForeground` and `text-inputForeground`, so the dimmed sidebar labels and icons and the snapshot address bar text now use their intended theme colours.
