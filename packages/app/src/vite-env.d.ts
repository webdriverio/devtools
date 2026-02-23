/* eslint-disable @typescript-eslint/consistent-type-imports */
/// <reference types="vite/client" />

interface CommandEventProps {
  command: import('@wdio/devtools-service/types').CommandLog
  elapsedTime: number
}

interface GlobalEventHandlersEventMap {
  'app-mutation-highlight': CustomEvent<TraceMutation | null>
  'app-mutation-select': CustomEvent<TraceMutation>
  'app-source-highlight': CustomEvent<string>

  'app-test-filter': CustomEvent<
    import('./components/sidebar/filter').DevtoolsSidebarFilter
  >
  'app-test-run': CustomEvent<
    import('./components/sidebar/test-suite').TestRunDetail
  >
  'app-test-stop': CustomEvent<
    import('./components/sidebar/test-suite').TestRunDetail
  >
  'app-logs': CustomEvent<string>
  'load-trace': CustomEvent<TraceLog>
  'show-command': CustomEvent<CommandEventProps>
  'clear-execution-data': CustomEvent<{ uid?: string }>
}
