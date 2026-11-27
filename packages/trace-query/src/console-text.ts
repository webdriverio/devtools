import { stripAnsi, type ConsoleLog } from '@wdio/devtools-shared'

// A string reads as itself and anything else as compact JSON, which is how a value a page logged reads apart from text; one with no JSON form (a function, a symbol) falls back to its own text.
function argText(arg: unknown): string {
  return typeof arg === 'string' ? arg : (JSON.stringify(arg) ?? String(arg))
}

/** A console or stdio line as one string, without terminal colour codes or surrounding whitespace. */
export function consoleText(log: ConsoleLog): string {
  return stripAnsi(log.args.map(argText).join(' ')).trim()
}
