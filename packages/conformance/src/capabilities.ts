import { RULES } from './constants.js'
import type { AdapterId, RuleId } from './types.js'

// A Record, so a new adapter id fails to compile until it has a column title.
const ADAPTER_TITLES: Record<AdapterId, string> = {
  'devtools-service': 'WebdriverIO',
  'selenium-devtools': 'Selenium',
  'nightwatch-devtools': 'Nightwatch',
  'selenium-devtools-py': 'Python'
}

/** Column order of every rendered table. */
export const ADAPTER_COLUMNS = (
  Object.entries(ADAPTER_TITLES) as [AdapterId, string][]
).map(([id, title]) => ({ id, title }))

/** Rules that prove no feature cell on their own: a comparison between adapters, or a precondition of a feature rather than the feature. */
export const INTERNAL_RULES: Partial<Record<RuleId, string>> = {
  [RULES.agreeOnRequests]:
    'Compares the adapters with one another; each adapter is judged by every-browser-request-listed.',
  [RULES.agreeOnActions]:
    'Compares the adapters with one another; each adapter is judged by one-row-per-browser-action.',
  [RULES.agreeOnErrors]:
    'Compares the adapters with one another; each adapter is judged by failed-command-has-error-row.',
  [RULES.agreeOnPages]:
    'Compares the adapters with one another; each adapter is judged by row-replays-its-page.',
  [RULES.agreeOnSnapshots]:
    'Compares the adapters with one another; each adapter is judged by every-document-anchored.',
  [RULES.agreeOnRunControls]:
    'Compares the adapters with one another; each adapter is judged by run-controls-are-served.',
  [RULES.metadataFirst]:
    'Checks that metadata reaches the dashboard before the first command, not the session, capabilities and device the Metadata tab shows.',
  [RULES.testsAsDesigned]:
    'Checks that each scenario test is reported in the state it was written to end in, a precondition of every per-test view rather than a feature.',
  [RULES.testHasRows]:
    'Checks that every reported test owns at least one row, a precondition of every per-test view rather than a feature.',
  [RULES.runControlsServed]:
    'Checks that every run control the dashboard offers has a command to serve it, not that Run, Rerun and Run all work.'
}
