/** Playback speed multipliers offered in the timeline controls. */
export const SPEEDS = [0.5, 1, 2, 3, 5]

/** Window events linking the controls bar and the timeline strip — same
 *  decoupling pattern as the KBD events, so either side can be re-homed. */
export const PLAYER_STATE_EVENT = 'trace-player:state'
export const PLAYER_RESTART_EVENT = 'trace-player:restart'
export const PLAYER_SPEED_EVENT = 'trace-player:speed'

export interface PlayerState {
  currentMs: number
  duration: number
  playing: boolean
  speed: number
}
