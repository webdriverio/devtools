---
'@wdio/elements': patch
---

The published type declarations are now self-contained. They imported `BrowserElementInfo`, `AccessibilityNode`, `ElementWithLocators` and the other element and locator types from an internal package that is not published, so with `skipLibCheck` off a consumer got `TS2307: Cannot find module '@wdio/devtools-core/...'`, and with it on every one of those types, and the results of `getElements` and `getInteractableBrowserElements`, silently became `any`. Those types are now declared in the package itself.
