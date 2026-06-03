// File-pattern regexes shared across packages — keep one canonical form
// per concept so changes to "what counts as a test file" or "what counts
// as a Cucumber feature file" propagate everywhere. See CLAUDE.md §2.1.

/** Matches `*.test.ts`, `*.spec.ts`, `*.test.cjs`, etc. — the test-runner
 *  convention used by every adapter to recognize spec files. */
export const SPEC_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i

/** Matches `*.feature` — Cucumber feature files. */
export const FEATURE_FILE_RE = /\.feature$/i
