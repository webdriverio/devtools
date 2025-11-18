// const RUN_EVENT = 'app-run-tests'
const VIEW_SOURCE_EVENT = 'app-source-highlight'

export const viewSource = (
  callSource: string | undefined
) => {
  if (!callSource) return
  window.dispatchEvent(
    new CustomEvent(VIEW_SOURCE_EVENT, {
      detail:  callSource
    })
  )
}
