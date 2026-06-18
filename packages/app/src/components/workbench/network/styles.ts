import { css } from 'lit'

/** Component styles for `<wdio-devtools-network>`. Pulled out so the main
 *  network component file stays focused on request filtering and rendering. */
export const networkStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    color: var(--vscode-foreground);
    background-color: var(--vscode-sideBar-background);
  }

  /* ── Toolbar: filter input + segmented type filter ── */
  .network-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    max-width: 280px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-input-background);
    color: var(--vscode-foreground);
    border-radius: 8px;
    font-size: 12px;
  }
  .search-input::placeholder {
    color: var(--vscode-descriptionForeground);
  }
  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .filter-tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-input-background);
  }
  .filter-tab {
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .filter-tab:hover {
    color: var(--vscode-foreground);
  }
  .filter-tab.active {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  /* ── List + detail split ── */
  .network-content {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .requests-list {
    flex: 1.4;
    min-width: 0;
    overflow: auto;
    padding: 0 8px 12px;
  }

  .grid {
    display: grid;
    grid-template-columns:
      minmax(160px, 2fr) 64px 76px minmax(110px, 1.2fr)
      minmax(90px, 0.8fr) 76px 76px;
    align-items: center;
    gap: 14px;
    /* Keep the row box wide enough to contain every column (incl. the row's
       own 10px padding) when the detail panel narrows the list — so the
       highlight spans full width, Size isn't clipped, and it scrolls instead. */
    min-width: 800px;
  }
  .requests-header {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vscode-sideBar-background);
    padding: 8px 10px;
    font-size: 10px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .col-num {
    text-align: right;
  }

  .request-row {
    padding: 7px 10px;
    font-size: 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .request-row:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .request-row.selected {
    background: var(--vscode-editorWidget-background);
    box-shadow: inset 0 0 0 1px var(--vscode-panel-border);
  }

  .req-name {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-foreground);
  }
  .req-name .type-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* content-type dots (tokens only) */
  .type-html {
    background: var(--accent);
  }
  .type-css {
    background: var(--vscode-charts-blue);
  }
  .type-js {
    background: var(--vscode-charts-yellow);
  }
  .type-image {
    background: var(--vscode-charts-green);
  }
  .type-font {
    background: var(--vscode-charts-purple);
  }
  .type-fetch {
    background: var(--vscode-charts-orange);
  }
  .type-other {
    background: var(--vscode-descriptionForeground);
  }

  .req-method {
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .req-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--vscode-editor-font-family);
    font-variant-numeric: tabular-nums;
  }
  .req-status .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .kind-ok {
    color: var(--vscode-charts-green);
  }
  .kind-redirect {
    color: var(--vscode-charts-yellow);
  }
  .kind-error {
    color: var(--vscode-charts-red);
  }
  .kind-pending {
    color: var(--vscode-descriptionForeground);
  }

  .req-type,
  .req-dur,
  .req-size {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .req-dur,
  .req-size {
    font-family: var(--vscode-editor-font-family);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .req-dur-empty {
    color: var(--vscode-disabledForeground);
  }

  /* ── waterfall column: thin track + duration-proportional bar ── */
  .req-wf {
    position: relative;
    min-width: 0;
    height: 16px;
  }
  /* fixed-height pill, vertically centred (never derived from the row height) */
  .wf-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    overflow: hidden;
  }
  .wf-bar {
    position: absolute;
    top: 0;
    height: 100%;
    min-width: 2px;
    border-radius: 999px;
    /* accent gradient like the mock; errors/pending recolour via --wf-color */
    --wf-color: var(--accent, var(--vscode-charts-blue));
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--wf-color) 50%, transparent),
      var(--wf-color)
    );
  }
  .wf-bar.kind-error {
    --wf-color: var(--vscode-charts-red);
  }
  .wf-bar.kind-pending {
    --wf-color: var(--vscode-descriptionForeground);
  }

  .filter-empty {
    padding: 1rem;
    text-align: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Detail panel ── */
  .request-detail {
    flex: 1;
    min-width: 280px;
    overflow: auto;
    border-left: 1px solid var(--vscode-panel-border);
    padding: 14px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .detail-title {
    font-size: 10.5px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
  }
  .kv-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    overflow: hidden;
  }
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14px;
    padding: 9px 14px;
    font-size: 12px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .kv:first-child {
    border-top: none;
  }
  .kv .k {
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    white-space: nowrap;
  }
  .kv .v {
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family);
    word-break: break-all;
    text-align: right;
  }
  .kv .v pre {
    margin: 0;
    white-space: pre-wrap;
    text-align: left;
  }
`
