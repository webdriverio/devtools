/// <reference types="vite/client" />

interface GlobalEventHandlersEventMap {
  'app-mutation': CustomEvent<MutationRecord>
  'app-mutation-highlight': CustomEvent<MutationRecord>
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  'app-test-filter': CustomEvent<import('./components/sidebar/filter').DevtoolsSidebarFilter>
}
