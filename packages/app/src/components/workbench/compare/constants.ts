export const POPOUT_QUERY = {
  viewKey: 'view',
  viewValue: 'compare',
  uidKey: 'uid'
} as const

export const POPOUT_WINDOW = {
  width: 1400,
  height: 900,
  features: 'resizable=yes,scrollbars=yes'
} as const

export function buildPopoutFeatures() {
  return `width=${POPOUT_WINDOW.width},height=${POPOUT_WINDOW.height},${POPOUT_WINDOW.features}`
}
