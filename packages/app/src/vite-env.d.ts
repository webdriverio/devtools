/// <reference types="vite/client" />

interface GlobalEventHandlersEventMap {
  'app-mutation-highlight': CustomEvent<TraceMutation>
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  'app-test-filter': CustomEvent<import('./components/sidebar/filter').DevtoolsSidebarFilter>
  'app-logs': CustomEvent<string>
}
