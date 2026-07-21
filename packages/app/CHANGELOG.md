# @wdio/devtools-app

## 1.8.1

### Patch Changes

- Updated dependencies [64d54a9]
  - @wdio/devtools-service@10.7.1

## 1.8.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [e1e859b]
- Updated dependencies [66309cf]
  - @wdio/devtools-service@10.7.0

## 1.7.0

### Minor Changes

- 93d3851: ### 🚀 Features

  - **Dashboard UI redesign**: port the entire dashboard to the new design mockup — sidebar, header, tabs, and workbench layout align with the updated visual system; theme-adaptive light mode with a segmented toggle.
  - **Timeline & action rail**: new timeline chips, connector rail, and active-row highlighting; action durations color-coded by per-step heat with consistent timing; rail extends across all actions.
  - **Sidebar filtering**: status chips in the sidebar now act as the single-select test filter.
  - **Screencast scrubber**: a scrubber with action markers synced to screencast playback; clicking an action seeks the screencast to that moment.
  - **Network panel redesign**: new layout for the Network tab; added a waterfall view for request timing.
  - **Metadata tab redesign**: collapsible cards replace the flat metadata layout.
  - **Console & Log redesign**: updated layout for the Console and Log tabs; console level filters consolidated into the filter module.
  - **Source panel redesign**: file switcher with call-site context replaces the flat source view.
  - **Compare tab redesign**: updated to match the new design mockup with aligned status markers.
  - **iframe URL mapping**: page URLs now resolve correctly for iframe-hosted pages, and the browser preview frame stays stable across Snapshot/Screencast tabs.

  ### 🐛 Fixes
  - **Baseline command attribution**: assertion commands issued by the framework are now kept with the test that ran them, and preserved baseline commands are attributed by source location.
  - **Automation infobar**: the "Chrome is being controlled by automated test software" infobar is hidden on the dashboard window (service and nightwatch adapters).
  - **Layout polish**: resize-divider line now aligns with the pane boundary; sidebar test-row content and selected-row highlight are evenly spaced.

  ### ⚡ Improvements
  - **Nightwatch PerfLog parsing**: waterfall timing data is now extracted from CDP performance logs for the Network waterfall view.
  - **Console filter consolidation**: console level filters moved to the shared filter module; dead code removed.

### Patch Changes

- Updated dependencies [93d3851]
- Updated dependencies [cf011cb]
  - @wdio/devtools-service@10.6.1
