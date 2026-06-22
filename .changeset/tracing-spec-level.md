---
"@wdio/devtools-service": patch
"@wdio/nightwatch-devtools": patch
"@wdio/selenium-devtools": patch
---

### ⚡ Improvements
- Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
  - `spec` mode writes one trace per spec file, keyed on filename
  - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
  - Fix `lastSelector` bleed-through between consecutive tests
  - Annotate tracing spans with `it()` test names
