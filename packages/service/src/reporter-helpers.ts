import { TestStats, type HookStats, type SuiteStats } from '@wdio/reporter'
import { deterministicUid } from '@wdio/devtools-core'
import { CUCUMBER_HOOK_LABEL } from './constants.js'

export function isCucumberSuite(
  suite: SuiteStats | undefined
): suite is SuiteStats {
  const type = (suite as { type?: string } | undefined)?.type
  return type === 'feature' || type === 'scenario'
}

/** 1-based position among the owner's hooks of the same kind, stable across attempts and processes; undefined when the owner does not hold it. */
function hookPosition(hook: HookStats, owner: SuiteStats): number | undefined {
  const index = owner.hooks
    .filter((h) => h.hookKind === hook.hookKind)
    .indexOf(hook)
  return index === -1 ? undefined : index + 1
}

function hookRowTitle(hook: HookStats, position: number | undefined): string {
  const label = (hook.hookKind && CUCUMBER_HOOK_LABEL[hook.hookKind]) || 'Hook'
  const name = hook.title?.trim()
  const title = !name
    ? label
    : name.startsWith(label)
      ? name
      : `${label} ${name}`
  return position && position > 1 ? `${title} #${position}` : title
}

// The dashboard renders tests and suites, never hooks, so a failed hook becomes a failed test.
export function failedHookRow(
  hook: HookStats,
  owner: SuiteStats,
  ownerFrameworkUid: string,
  error: Error
): TestStats {
  const position = hookPosition(hook, owner)
  const title = hookRowTitle(hook, position)
  // Without a position the framework's hook id tells two hooks apart, though not across processes.
  const discriminator = position ? String(position) : `id:${hook.uid}`
  const row = new TestStats({
    type: 'test:fail',
    uid: deterministicUid(
      owner.uid,
      'hook',
      hook.hookKind ?? '',
      discriminator
    ),
    title,
    fullTitle: title,
    parent: ownerFrameworkUid,
    pending: false,
    file: owner.file,
    cid: hook.cid,
    specs: []
  })
  row.start = hook.start
  row.fail([error], hook.end ?? new Date())
  row.retries = 0
  return row
}

// Without an `order` on every child the app lists tests first; children already numbered keep theirs.
export function orderLast(suite: SuiteStats, row: TestStats): void {
  let next = 0
  for (const child of [
    ...suite.tests.filter((t) => t !== row),
    ...suite.suites
  ]) {
    child.order ??= next
    next = Math.max(next, child.order + 1)
  }
  row.order = next
}

/** A test's identity across its attempts: its parallel context when it has one, then file and fullTitle. */
export function attemptKey(testStats: TestStats): string {
  const title = testStats.fullTitle || testStats.title
  return `${testStats.contextId ?? ''}::${testStats.file ?? ''}::${title}`
}

export function descendants(suite: SuiteStats | undefined): SuiteStats[] {
  return (suite?.suites ?? []).flatMap((child) => [
    child,
    ...descendants(child)
  ])
}
