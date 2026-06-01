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
    background-color: var(--vscode-editor-background);
  }

  .network-header {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-shrink: 0;
  }

  .search-input {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 4px;
    font-size: 0.875rem;
    min-width: 200px;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .filter-tabs {
    display: flex;
    gap: 0.25rem;
    margin-left: 1rem;
  }

  .filter-tab {
    padding: 0.375rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s;
    border-bottom: 2px solid transparent;
  }

  .filter-tab:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .filter-tab.active {
    color: var(--vscode-textLink-activeForeground);
    border-bottom-color: var(--vscode-textLink-activeForeground);
  }

  .network-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .requests-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    border-right: 1px solid var(--vscode-panel-border);
    min-width: 0;
  }

  .requests-header {
    display: grid;
    grid-template-columns: 200px 80px 70px 180px 90px 80px 90px;
    min-width: 790px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    z-index: 1;
  }

  .requests-header > div {
    padding: 0.5rem;
    border-right: 1px solid var(--vscode-panel-border);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .requests-header > div:last-child {
    border-right: none;
  }

  .request-row {
    display: grid;
    grid-template-columns: 200px 80px 70px 180px 90px 80px 90px;
    min-width: 790px;
    border-bottom: 1px solid var(--vscode-panel-border);
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.15s;
    align-items: center;
  }

  .request-row > span {
    padding: 0.5rem;
    border-right: 1px solid var(--vscode-panel-border);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .request-row > span:last-child {
    border-right: none;
  }

  .request-row:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .request-row.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .request-row.error {
    color: var(--vscode-errorForeground);
  }

  .request-detail {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    min-width: 400px;
  }

  .detail-section {
    margin-bottom: 1.5rem;
  }

  .detail-title {
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--vscode-foreground);
  }

  .detail-content {
    background: var(--vscode-editor-background);
    padding: 0.75rem;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border);
    font-family: monospace;
    font-size: 0.75rem;
    overflow-x: auto;
  }

  .header-row {
    display: flex;
    gap: 1rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .header-key {
    font-weight: 600;
    color: var(--vscode-symbolIcon-keyForeground);
    flex-shrink: 0;
    min-width: 80px;
  }

  .header-value {
    color: var(--vscode-symbolIcon-stringForeground);
    word-break: break-word;
    flex: 1;
    text-align: right;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text-muted {
    color: var(--vscode-descriptionForeground);
  }
`
