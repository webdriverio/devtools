/** Playback speed multipliers offered in the timeline controls. */
export const SPEEDS = [0.5, 1, 2, 3, 5]

/** Candidate ruler intervals (ms); tickStep picks the smallest fitting one. */
export const TICK_STEPS = [
  100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000
]

/** Ruler divisions to aim for — keeps labels readable at any duration. */
export const TICK_TARGET_DIVISIONS = 14

/** Window events linking the controls bar and the timeline strip (KBD-style). */
export const PLAYER_STATE_EVENT = 'trace-player:state'
export const PLAYER_RESTART_EVENT = 'trace-player:restart'
export const PLAYER_SPEED_EVENT = 'trace-player:speed'

export interface PlayerState {
  currentMs: number
  duration: number
  playing: boolean
  speed: number
}
