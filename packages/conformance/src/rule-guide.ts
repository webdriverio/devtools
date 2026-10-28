import type { RuleGuide, RuleId } from './types.js'

/** Per rule: what a break means, its usual cause, and the adapter responsibility it tests. */
export const RULE_GUIDE: Record<RuleId, RuleGuide> = {
  'metadata-before-commands': {
    meaning:
      'Command rows arrived before the session metadata, so the dashboard has no session to file them under.',
    cause: 'Metadata is sent lazily, after the first command is captured.',
    responsibility: 'wire-contract'
  },
  'row-stamped-at-completion': {
    meaning: 'A row ends before it starts: its timestamps are inconsistent.',
    cause:
      'timestamp and startTime are taken from different clocks, or swapped.',
    responsibility: 'command-interception'
  },
  'anchor-carries-birth-time': {
    meaning:
      "A full-page DOM snapshot is stamped with a time that matches no page's birth, so replay applies it to the wrong page.",
    cause:
      'The anchor is stamped at drain time instead of keeping the document birth time the collector gave it.',
    responsibility: 'collector'
  },
  'every-document-anchored': {
    meaning:
      'A page the browser loaded never got a full-page DOM snapshot, so the dashboard has nothing to replay for it.',
    cause:
      'The drain does not force captureCurrentDom(), or the collector was never present in that document (no preload, injection too late).',
    responsibility: 'collector'
  },
  'one-anchor-per-document': {
    meaning: 'A page got more than one full-page snapshot.',
    cause:
      'The collector was injected twice into one document, resetting its once-per-document guard.',
    responsibility: 'collector'
  },
  'row-replays-its-page': {
    meaning:
      'Replaying a row shows a page other than the one the browser was on when its action completed: the page it left, a later page, or no page at all.',
    cause:
      'The row is stamped at a moment other than its completion, or the page was never anchored (check every-document-anchored first).',
    responsibility: 'command-interception'
  },
  'navigation-row-names-its-destination': {
    meaning:
      'A navigation row names a page other than the one the browser loaded for it.',
    cause:
      'The url the row carries is read from the wrong argument, or rewritten by the binding before capture.',
    responsibility: 'command-interception'
  },
  'navigation-row-carries-timings': {
    meaning:
      'A navigation row never shows the page load timings, so its detail card has no load, DOM-ready or resource figures.',
    cause:
      "The page's Performance API is not read after the navigation, its answer is dropped (a script that does not return its result), or the enriched row is never sent as a replaceCommand.",
    responsibility: 'command-interception'
  },
  'page-level-assertion-names-no-element': {
    meaning:
      'An assertion on the page title boxes an element, so the replay points at something the assertion was never about.',
    cause:
      "The assertion's target is taken from the last element touched, or from an operand an element once read, instead of from the read that produced the compared value. A driver-level read such as the title must record its value as belonging to no element.",
    responsibility: 'command-interception'
  },
  'failed-command-has-error-row': {
    meaning:
      'A command failed in the browser, but no row carries the error, so the dashboard shows it as a success or not at all.',
    cause: 'The interception path does not report a command that throws.',
    responsibility: 'command-interception'
  },
  'error-row-carries-browser-message': {
    meaning:
      "The Errors tab shows a failed command's message as the language binding formatted it, not as the browser sent it.",
    cause:
      "The row stores the exception's string form, which some bindings decorate with a prefix or a stacktrace. Store the driver's own message field.",
    responsibility: 'command-interception'
  },
  'replace-targets-a-sent-row': {
    meaning:
      'An update names a row that was never sent, so the dashboard appends it as a new row.',
    cause:
      'The update is sent before its row, or keyed by a timestamp the row does not carry.',
    responsibility: 'wire-contract'
  },
  'run-controls-are-served': {
    meaning:
      'The dashboard shows Run buttons, but pressing one makes the backend fall back to the WebdriverIO binary.',
    cause:
      'Run capabilities are declared without a launchCommand, a rerunCommand or a configFile the backend can rerun. Derive capabilities from what exists.',
    responsibility: 'transport'
  },
  'failed-test-has-error-row': {
    meaning:
      'A test failed, but none of its rows carries an error, so the Actions list and the Errors tab show a test that simply stopped.',
    cause:
      'The step that failed (an element wait, an assertion) is not a captured command, or its failure is caught without being recorded on a row.',
    responsibility: 'command-interception'
  },
  'call-site-names-the-scenario': {
    meaning:
      "A row's call site points somewhere other than the line of the spec that issued it, often into DevTools' own code.",
    cause:
      "The stack walk does not skip the adapter's own frames, or reads them before source maps rewrite their paths (tsx, vitest).",
    responsibility: 'command-interception'
  },
  'every-test-has-rows': {
    meaning:
      'A test the suite tree shows has no rows, so selecting it shows nothing it did.',
    cause:
      'Test hooks are registered after the test started, or rows are stamped with a test uid the tree does not carry.',
    responsibility: 'framework-hooks'
  },
  'tests-end-as-designed': {
    meaning:
      'The dashboard shows a scenario test in a state other than the one it was written to end in, or not at all: a passing test shown failed or skipped, or a test missing from the tree.',
    cause:
      'Capture changed what the test did (a command run out of order, a test aborted), or the suite tree reports a test state the runner did not.',
    responsibility: 'framework-hooks'
  },
  'adapters-agree-on-actions': {
    meaning:
      'For the same scenario, the adapters report a different sequence of user actions.',
    cause:
      'One adapter skips, adds or misnames a command; compare the two columns in the agreement table.',
    responsibility: 'command-interception'
  },
  'adapters-agree-on-errors': {
    meaning:
      'The same step succeeded in one adapter and failed in another, or failed with different text.',
    cause:
      'One adapter reports the error differently: a decorated message, or a failure it never reports.',
    responsibility: 'command-interception'
  },
  'adapters-agree-on-pages': {
    meaning:
      'Replaying the same step shows a different page in different adapters.',
    cause:
      'One adapter stamps the row at a different moment, or anchors the page at a different time or not at all.',
    responsibility: 'collector'
  },
  'adapters-agree-on-snapshots': {
    meaning: 'The adapters captured full-page snapshots of different pages.',
    cause:
      'One adapter drains or injects the collector at different moments, or does not force the anchor.',
    responsibility: 'collector'
  },
  'adapters-agree-on-run-controls': {
    meaning:
      'The adapters offer different Run buttons, or one has no command behind them.',
    cause:
      'Run capabilities are declared differently; derive them from the commands each adapter builds.',
    responsibility: 'transport'
  },
  'one-row-per-browser-action': {
    meaning:
      'The rows do not match what the browser did: a navigation, click or keystroke is missing or appears twice.',
    cause:
      'A command is skipped or captured twice by the interception, or an update overwrote another row (updates match by id, then timestamp).',
    responsibility: 'command-interception'
  },
  'every-browser-request-listed': {
    meaning:
      'The Network tab lists fewer rows for a url than the loads the browser made of it.',
    cause:
      "The page's Resource Timing rows are withheld although nothing else served the request: a BiDi subscription that delivered nothing counted as a source, or the page was left before its buffer was drained.",
    responsibility: 'collector'
  },
  'one-row-per-browser-request': {
    meaning:
      'The Network tab lists more rows for a url than the loads the browser made of it.',
    cause:
      'Two sources listed the same load, or a re-sent row carried a new id instead of the one it replaces.',
    responsibility: 'collector'
  },
  'request-row-carries-what-the-browser-served': {
    meaning:
      'A request row carries less than its source could give, or claims a source the browser never served: with BiDi live it lacks a status or headers; without BiDi it carries neither a status and headers nor the Resource Timing mark.',
    cause:
      "With BiDi live, the driver's events were not subscribed or not folded into the row. Without BiDi, the page's Resource Timing rows were rewritten as if a driver had seen them.",
    responsibility: 'collector'
  },
  'adapters-agree-on-requests': {
    meaning:
      'For the same scenario, the adapters list different requests in the Network tab.',
    cause:
      'One adapter gates or deduplicates its network sources differently; compare the requests row in the agreement table.',
    responsibility: 'collector'
  }
}
