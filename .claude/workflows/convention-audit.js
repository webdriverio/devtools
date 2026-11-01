export const meta = {
  name: 'convention-audit',
  description: 'Audit the monorepo against CLAUDE.md invariants; adversarially verify each finding to drop false positives',
  whenToUse: 'Before pushing a branch, or anytime you want a confidence check that the diff (or whole repo) still honors the CLAUDE.md conventions.',
  phases: [
    { title: 'Audit', detail: 'one checker per CLAUDE.md rule, in parallel' },
    { title: 'Verify', detail: 'an independent skeptic re-opens each finding and tries to refute it' },
  ],
}

// Runs at the repo root, so packages/** paths are relative. Pass an optional
// scope string via `args` (e.g. "only files changed on this branch vs main")
// to focus the audit; omit to sweep the whole repo.
const SCOPE = typeof args === 'string' && args.trim() ? `\nSCOPE: ${args.trim()}\n` : ''

const CONTEXT = `
You are auditing the "devtools" monorepo (root = the current working directory). It is a Lit-based dashboard for E2E browser tests.
Packages under packages/: shared (types/contracts, private), core (framework-agnostic capture, private),
service + nightwatch-devtools + selenium-devtools (thin framework ADAPTERS), backend (server), app (UI),
script (page-injected runtime), elements (a UI-elements package, NOT documented in CLAUDE.md).
The conventions you are checking are defined in ./CLAUDE.md — read it if a rule below is ambiguous.
${SCOPE}
Use grep/glob/read to investigate. Report ONLY concrete violations with file + line. If you find none, return an empty array.
Do NOT flag anything listed as KNOWN DEBT in CLAUDE.md (§ Known debt) — those are sanctioned exceptions, including:
- replaceCommand's dual semantics; patchNodeAssert wired only in selenium; BiDi opt-in in nightwatch.
- packages/nightwatch-devtools/src/index.ts, packages/selenium-devtools/src/index.ts, packages/nightwatch-devtools/src/session.ts (accepted over the 500-line mark).
- Declarative #getInternals / PluginInternals accessor bags exceeding the 50-line function cap (marked with eslint-disable).
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'file', 'line', 'severity', 'snippet', 'why'],
        properties: {
          rule: { type: 'string', description: 'short rule id, e.g. adapter-cross-import' },
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'number', description: 'line number, or 0 if file-level' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          snippet: { type: 'string', description: 'the offending line(s), trimmed' },
          why: { type: 'string', description: 'which CLAUDE.md rule this breaks and why' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reason'],
  properties: {
    isReal: { type: 'boolean', description: 'true only if this is a genuine, present violation' },
    reason: { type: 'string', description: 'one-line justification, citing what you re-checked' },
  },
}

const CHECKERS = [
  {
    key: 'adapter-cross-import',
    prompt: `Rule: adapters import from shared and core, NEVER from each other; backend and app NEVER import an adapter package.
Check every import in packages/{service,nightwatch-devtools,selenium-devtools,backend,app}/src/**.
Flag any import of @wdio/devtools-service / selenium-devtools / nightwatch-devtools from a sibling adapter, backend, or app.`,
  },
  {
    key: 'dist-workspace-leak',
    prompt: `Rule: built dist must inline shared/core, never reference them. Run:
grep -rE "@wdio/devtools-(core|shared)|/packages/(core|shared)/" packages/*/dist/*.js (and dist subfolders).
Any hit is a high-severity violation (the workspace path leaked into the bundle). Report each matching file+line.`,
  },
  {
    key: 'dep-placement',
    prompt: `Rule: @wdio/devtools-shared and @wdio/devtools-core must appear in devDependencies with "workspace:^", and must NOT appear in "dependencies", in every consuming package.json.
Read each packages/*/package.json and flag any placement of these two in "dependencies", or any version spec that isn't workspace:^.`,
  },
  {
    key: 'any-at-boundary',
    prompt: `Rule: no \`any\` crosses a package boundary; where a framework forces it, the any is cast to a typed shape at the boundary WITH a one-line comment explaining why. Also: no \`as unknown as X\` double-cast without a documented inline reason.
Grep packages/**/src for ": any", "<any>", "as any", "as unknown as". Flag exported signatures using any, and any/double-casts that lack an adjacent explaining comment. Ignore *.test.ts.`,
  },
  {
    key: 'banned-comments',
    prompt: `Rule: these comment forms are not used: "// TODO", "// FIXME", "// added for", "// removed", "// keep in sync".
Grep packages/**/src for them. Flag each occurrence. Ignore *.test.ts and node_modules.`,
  },
  {
    key: 'framework-dispatch',
    prompt: `Rule: framework-specific backend behavior lives only in runner.ts and framework-filters.ts and branches on a typed TestRunnerId, never a magic string. framework-filters dispatch must be a switch over TestRunnerId, not a dynamic table/object lookup.
Read packages/backend/src/framework-filters.ts and runner.ts. Flag: dynamic method/property lookup by runner string, magic-string comparisons against runner ids outside these two files, or framework branching elsewhere in backend/app.`,
  },
  {
    key: 'duplicate-types',
    prompt: `Rule: one source of truth — every shared type/constant/enum/contract lives in packages/shared and is re-exported, never re-declared downstream.
Look for type/interface/const declarations in adapters, backend, or app that duplicate a name already exported from packages/shared (e.g. TestStatus, TestRunnerId, SocketMessage, WS/HTTP contract shapes). Flag genuine re-declarations, not re-exports or value-only accessors. A re-declaration explicitly documented in CLAUDE.md or shared (e.g. TraceMutation for browser-side DOM typing) is sanctioned — do not flag it.`,
  },
  {
    key: 'file-size',
    prompt: `Rule: soft cap 500 LOGIC lines per file (blanks + comment-only lines excluded). Find packages/**/src files whose raw line count exceeds ~520, then confirm by running the repo's own eslint (max-lines with skipBlankLines/skipComments) on the candidate. Report only files NOT in the CLAUDE.md known-debt list that eslint actually reports as over 500. Severity low.`,
  },
]

phase('Audit')
const results = await pipeline(
  CHECKERS,
  (c) => agent(`${CONTEXT}\n\nYOUR CHECK:\n${c.prompt}`, {
    label: `audit:${c.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA,
  }),
  (res, c) => {
    const findings = (res?.findings ?? []).map((f) => ({ ...f, rule: f.rule || c.key }))
    if (!findings.length) return []
    return parallel(findings.map((f) => () =>
      agent(`${CONTEXT}\n\nAdversarially verify this claimed violation. Open the file, read the actual lines, and decide if it is a REAL, present violation of the stated CLAUDE.md rule — not a false positive, not a re-export, not sanctioned known-debt. Default isReal=false if you cannot confirm it at the cited location.\n\nCLAIM: ${JSON.stringify(f)}`, {
        label: `verify:${f.rule}@${f.file.split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT_SCHEMA,
      }).then((v) => ({ ...f, verdict: v })).catch(() => null)
    ))
  },
)

const flat = results.flat().filter(Boolean)
const confirmed = flat.filter((f) => f.verdict?.isReal)
const rejected = flat.filter((f) => f.verdict && !f.verdict.isReal)
const sev = { high: 0, medium: 1, low: 2 }

log(`Confirmed ${confirmed.length} violation(s); dropped ${rejected.length} as false-positive/known-debt.`)

return {
  confirmed: confirmed.sort((a, b) => sev[a.severity] - sev[b.severity]),
  droppedCount: rejected.length,
  droppedSample: rejected.slice(0, 6).map((f) => ({ rule: f.rule, file: f.file, line: f.line, reason: f.verdict.reason })),
}
