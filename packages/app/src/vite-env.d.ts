/// <reference types="vite/client" />

interface CommandEventProps {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  command: import('@wdio/devtools-service/types').CommandLog
  elapsedTime: number
}

interface GlobalEventHandlersEventMap {
  'app-mutation-highlight': CustomEvent<TraceMutation | null>
  'app-mutation-select': CustomEvent<TraceMutation>
  'app-source-highlight': CustomEvent<string>
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  'app-test-filter': CustomEvent<import('./components/sidebar/filter').DevtoolsSidebarFilter>
  'app-logs': CustomEvent<string>
  'load-trace': CustomEvent<TraceLog>
  'show-command': CustomEvent<CommandEventProps>
}
