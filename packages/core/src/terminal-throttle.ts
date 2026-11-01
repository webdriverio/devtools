/**
 * Rate-limits high-frequency identical terminal (stdout/stderr) lines so a
 * polling framework that reprints the same line every ~100ms doesn't flood the
 * trace's console lane. The motivating case: WDIO's logger writes a
 * `COMMAND`/`RESULT` frame for every WebDriver command, so an `expect` that
 * polls for its full 10s timeout emits hundreds of near-identical lines.
 *
 * Only terminal-source capture goes through this — user `console.*` is
 * captured as `source: 'test'` and never throttled, so real user output is
 * untouched. Distinct lines always pass immediately; a repeat is emitted at
 * most once per window.
 */

/**
 * A repeated identical terminal line is emitted at most once per this window
 * (ms). Sized so a 100ms poll collapses ~10:1 while a human-paced reprint of
 * the same line (>1s apart) still shows every time.
 */
export const TERMINAL_REPEAT_WINDOW_MS = 1000

/**
 * Leading ISO-8601 timestamp emitted by most structured loggers (`@wdio/logger`'s
 * `%t %l %n:` template, pino, winston, …). It's the only volatile part of
 * otherwise-identical successive log frames, so it's stripped from the throttle
 * key — never from the emitted text.
 */
const LEADING_ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d\d\d)?Z {1,4}/

/** Key a terminal line for repeat-detection: drop a leading ISO timestamp so
 *  successive log frames of the same message collapse. */
export function terminalRepeatKey(line: string): string {
  return line.replace(LEADING_ISO_TIMESTAMP_RE, '')
}

export class TerminalLineThrottle {
  #lastEmitted = new Map<string, number>()
  readonly #windowMs: number

  constructor(windowMs: number = TERMINAL_REPEAT_WINDOW_MS) {
    this.#windowMs = windowMs
  }

  /**
   * True if the line should be emitted, false if it's a within-window repeat of
   * a line already emitted. The window is anchored to the last *emit*, not the
   * last occurrence, so a sustained stream of one line still emits once per
   * window instead of going silent after the first. Expired keys are pruned on
   * each emit, so state stays bounded by the number of distinct lines seen
   * within the window.
   */
  shouldEmit(line: string, now: number = Date.now()): boolean {
    const key = terminalRepeatKey(line)
    const last = this.#lastEmitted.get(key)
    if (last !== undefined && now - last < this.#windowMs) {
      return false
    }
    this.#lastEmitted.set(key, now)
    this.#prune(now)
    return true
  }

  #prune(now: number): void {
    for (const [key, ts] of this.#lastEmitted) {
      if (now - ts >= this.#windowMs) {
        this.#lastEmitted.delete(key)
      }
    }
  }
}
