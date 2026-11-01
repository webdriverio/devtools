import { css } from 'lit'

/** Search box plus segmented filter of the Console and Network toolbars. */
export const filterToolbarStyles = css`
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
`

/** Key/value card of the Log and Network detail panes; each host sets `.kv`'s columns. */
export const keyValueCardStyles = css`
  .kv-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    overflow: hidden;
  }
  .kv {
    display: grid;
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
`

/** Small dropdown of the Metadata session picker and the recording picker. */
export const compactSelectStyles = css`
  .compact-select {
    font-size: 11px;
    font-family: inherit;
    padding: 5px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-foreground);
    cursor: pointer;
    line-height: 1;
  }
`
