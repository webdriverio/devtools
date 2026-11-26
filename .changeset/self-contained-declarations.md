---
'@wdio/devtools-service': patch
'@wdio/devtools-backend': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

The published type declarations are now self-contained. They imported types from internal packages that are not published (the service through `../packages/...` paths outside the installed package, the others from `@wdio/devtools-shared`), so a consumer got `TS2307` with `skipLibCheck` off, and with it on the options inherited from the shared base were missing: a typed `ServiceOptions` rejected `mode`, `traceGranularity` and the other DevTools options as unknown properties. Those types are now declared in each package. The service ships one declaration file per entry (`index`, `types`, `launcher`) instead of one per source file.
