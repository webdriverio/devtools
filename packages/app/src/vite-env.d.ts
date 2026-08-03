/* eslint-disable @typescript-eslint/consistent-type-imports */
/// <reference types="vite/client" />

// unplugin-icons virtual modules. The plugin runs with `compiler:
// 'web-components'` + `autoDefine: true`, so importing one only registers a
// custom element — there is nothing to bind. An empty module body (rather than a
// shorthand `declare module '~icons/*'`, which would type the module `any`) is
// what lets the side-effect imports resolve under noUncheckedSideEffectImports
// while still rejecting `import Icon from '~icons/...'`.
declare module '~icons/*' {}

interface CommandEventProps {
  command: import('@wdio/devtools-shared').CommandLog
  elapsedTime: number
}

interface GlobalEventHandlersEventMap {
  'app-mutation-highlight': CustomEvent<TraceMutation | null>
  'app-mutation-select': CustomEvent<TraceMutation>
  'app-source-highlight': CustomEvent<string>
  'app-source-track': CustomEvent<{ callSource: string }>
  'app-screencast-progress': CustomEvent<{ time: number }>

  'app-test-filter': CustomEvent<
    import('./components/sidebar/filter').DevtoolsSidebarFilter
  >
  'app-status-filter': CustomEvent<
    import('./components/sidebar/types').StatusFilterDetail
  >
  'app-test-select': CustomEvent<string>
  'app-test-run': CustomEvent<
    import('./components/sidebar/types').TestRunDetail
  >
  'app-test-stop': CustomEvent<
    import('./components/sidebar/types').TestRunDetail
  >
  'app-logs': CustomEvent<string>
  'show-command': CustomEvent<CommandEventProps>
  'clear-execution-data': CustomEvent<{
    uid?: string
    entryType?: 'suite' | 'test'
  }>
}
