import { SCREENCAST_DEFAULTS, startsBackend } from '@wdio/devtools-shared'
import type { DevToolsOptions, ScreencastOptions } from '../types.js'

/** Outside live mode `enabled` is the one field that does not apply (filmstrip and video decide recording); the tuning fields still do. */
export function screencastFor(
  options: ScreencastOptions,
  mode: DevToolsOptions['mode']
): ScreencastOptions {
  return startsBackend(mode)
    ? { ...options }
    : { ...options, enabled: SCREENCAST_DEFAULTS.enabled }
}

/** The user's options as given, kept apart from the mode, so a later mode change re-derives from them rather than from an already-forced value; a recorder copies them when its driver is created, so a change reaches the next driver, not a running recording. */
export class ScreencastSettings {
  #input: ScreencastOptions
  #effective: Readonly<ScreencastOptions>

  constructor(
    user: ScreencastOptions | undefined,
    mode: DevToolsOptions['mode']
  ) {
    this.#input = { ...SCREENCAST_DEFAULTS, ...user }
    this.#effective = Object.freeze(screencastFor(this.#input, mode))
  }

  /** Frozen: a write would be lost at the next update(), so it throws instead; configure() is the way to change it. */
  get effective(): Readonly<ScreencastOptions> {
    return this.#effective
  }

  update(
    user: ScreencastOptions | undefined,
    mode: DevToolsOptions['mode']
  ): void {
    this.#input = { ...this.#input, ...user }
    this.#effective = Object.freeze(screencastFor(this.#input, mode))
  }
}
