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
  'navigation-row-shows-destination': {
    meaning:
      'Replaying a navigation row shows the page it left, or no page, instead of the page it loaded.',
    cause:
      'The row is stamped at invocation rather than completion, or the destination was never anchored (check every-document-anchored first).',
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
  'run-controls-have-a-command': {
    meaning:
      'The dashboard shows Run buttons, but pressing one makes the backend fall back to the WebdriverIO binary.',
    cause:
      'Run capabilities are declared without building launchCommand or rerunCommand. Derive capabilities from the commands that exist.',
    responsibility: 'transport'
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
  }
}
