// Lives in `trace` so the backend can run it; this keeps core's `./locators` export, which `@wdio/elements` imports.
export * from '@wdio/devtools-trace/locators/index'
