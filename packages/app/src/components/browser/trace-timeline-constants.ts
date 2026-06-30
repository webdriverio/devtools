import type { ActionCategory } from '../workbench/actionItems/category.js'

/** Playback speed multipliers offered in the timeline controls. */
export const SPEEDS = [0.5, 1, 2, 3, 5]

/** Width of the track-label gutter (px) — lanes start after it. */
export const GUTTER = 80

/** Right breathing room (px) so end-of-timeline markers don't hug the edge. */
export const INSET = 14

/** Tailwind background class per action category, for the timeline chips. */
export const CATEGORY_BG: Record<ActionCategory, string> = {
  navigation: 'bg-chartsBlue',
  input: 'bg-chartsPurple',
  assertion: 'bg-chartsGreen',
  query: 'bg-chartsYellow',
  other: 'bg-gray-500'
}
