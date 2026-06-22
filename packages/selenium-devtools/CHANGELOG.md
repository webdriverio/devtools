# @wdio/selenium-devtools

## 1.2.1

### Patch Changes

- cf011cb: ### ⚡ Improvements
  - Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
    - `spec` mode writes one trace per spec file, keyed on filename
    - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
    - Fix `lastSelector` bleed-through between consecutive tests
    - Annotate tracing spans with `it()` test names
- Updated dependencies [93d3851]
  - @wdio/devtools-backend@1.7.0
