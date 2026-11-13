import type { PushPlan } from './to-telemetry.js'

export function pushSummary(
  tests: number,
  plan: Pick<PushPlan, 'pushedManifests' | 'unsampledManifests' | 'runIds'>
): string {
  if (plan.pushedManifests === 0 && plan.unsampledManifests > 0) {
    return `pushed 0 test(s): all ${plan.unsampledManifests} manifest(s) were recorded under an unsampled TRACEPARENT`
  }
  const skipped =
    plan.unsampledManifests > 0
      ? `; ${plan.unsampledManifests} manifest(s) skipped as unsampled`
      : ''
  return `pushed ${tests} test(s) from ${plan.pushedManifests} manifest(s) across ${plan.runIds.length} run(s)${skipped}`
}
