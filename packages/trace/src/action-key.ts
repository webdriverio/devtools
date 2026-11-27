import type { CommandLog } from '@wdio/devtools-shared'

export function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ')
}

/** Command plus normalized selector: stable across runs, so a passing and a failing run's actions line up. */
export function actionKey(command: CommandLog): string {
  return command.selector
    ? `${command.command} ${normalizeSelector(command.selector)}`
    : command.command
}
