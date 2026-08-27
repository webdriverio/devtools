// Trace-format transforms: captured events in, trace zip out. See
// ARCHITECTURE.md §2 and CLAUDE.md §2.2.
//
// Split out of `core` because two layers need it and `core` is reachable from
// only one of them: adapters build their own trace, while the backend builds
// one on behalf of an adapter that cannot (the Python adapter ships no Node),
// and CLAUDE.md §2.2 bars the backend from importing `core`. Everything here
// is a pure transform over shared types — no framework API, no driver, no
// capture. Adapter-side policy and orchestration stay in `core`
// (`trace-finalizer`, `spec-trace-helpers`, `trace-retention`).

export * from './sha1.js'
export * from './screencast-trace.js'
export * from './trace-action-events.js'
export * from './trace-console.js'
export * from './trace-exporter.js'
export * from './trace-frame-snapshots.js'
export * from './trace-har.js'
export * from './trace-hierarchy.js'
export * from './trace-mutations.js'
export * from './trace-snapshots.js'
export * from './trace-sources.js'
export * from './trace-transcript.js'
export * from './trace-zip-writer.js'
