import { css } from 'lit'

/** Component styles for `<wdio-devtools-compare>`. Pulled out of compare.ts
 *  so the main component file stays focused on data and render logic. */
export const compareStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    /* Needed so popout mode (where Compare sits directly under body) is themed. */
    background-color: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-foreground, #cccccc);
  }

  /* ── Toolbar ── */
  .topbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 14px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11.5px;
    padding: 4px 11px;
    border-radius: 999px;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border);
  }
  .pill .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--vscode-editorLineNumber-foreground);
  }
  .pill.passed .dot {
    background: var(--vscode-charts-green);
  }
  .pill.failed {
    color: var(--vscode-charts-red);
    border-color: color-mix(in srgb, var(--vscode-charts-red) 35%, transparent);
  }
  .pill.failed .dot {
    background: var(--vscode-charts-red);
  }
  .swap-ico {
    color: var(--vscode-editorLineNumber-foreground);
  }
  .scope {
    font-size: 11px;
    color: var(--vscode-editorLineNumber-foreground);
  }
  .actions-group {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toggle-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
  }
  button.action {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-descriptionForeground);
    font-size: 11.5px;
    padding: 5px 12px;
    border-radius: 7px;
    cursor: pointer;
    font-family: inherit;
  }
  button.action:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-list-hoverBackground);
  }
  button.action.icon-only {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 8px;
  }
  button.action.icon-only svg {
    width: 1em;
    height: 1em;
  }

  /* ── Error banner ── */
  .error-banner {
    flex: none;
    margin: 12px 14px 0;
    padding: 10px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vscode-charts-red) 9%, transparent);
    border: 1px solid
      color-mix(in srgb, var(--vscode-charts-red) 25%, transparent);
  }
  .error-banner-title {
    font-size: 10px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--vscode-charts-red);
    margin-bottom: 5px;
  }
  /* Pre-wrap only on the message body so template indentation doesn't render. */
  .error-banner-message {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-foreground);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  /* ── Diff body ── */
  .cmp-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px;
  }
  .cmp-colhead {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    position: sticky;
    top: 0;
    z-index: 2;
    margin-bottom: 6px;
    padding: 2px 0 8px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .col-header {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    color: var(--vscode-foreground);
  }
  .cmp-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .step-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .step-cell {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    border-radius: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12.5px;
    color: var(--vscode-foreground);
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    cursor: pointer;
  }
  .step-cell code {
    font-family: inherit;
  }
  .step-cell:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .step-cell.divergent {
    background: color-mix(in srgb, var(--vscode-charts-red) 9%, transparent);
    border-color: color-mix(in srgb, var(--vscode-charts-red) 30%, transparent);
    box-shadow: inset 3px 0 0 var(--vscode-charts-red);
  }
  .step-cell.divergent.first {
    background: color-mix(in srgb, var(--vscode-charts-red) 16%, transparent);
  }
  .step-cell.expanded {
    outline: 1px solid var(--accent);
  }
  .step-cell.missing {
    justify-content: center;
    color: var(--vscode-editorLineNumber-foreground);
    background: transparent;
    border-style: dashed;
    cursor: default;
    font-style: italic;
  }

  /* ── Per-cell status markers ── */
  .marker {
    margin-left: auto;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 5px;
  }
  .marker.ok {
    padding: 0;
    background: transparent;
    font-size: 12px;
    color: var(--vscode-charts-green);
  }
  .marker.command,
  .marker.error {
    color: var(--vscode-charts-red);
    background: color-mix(in srgb, var(--vscode-charts-red) 16%, transparent);
  }
  .marker.result {
    color: var(--vscode-charts-yellow);
    background: color-mix(
      in srgb,
      var(--vscode-charts-yellow) 16%,
      transparent
    );
  }
  .marker.info {
    color: var(--vscode-charts-yellow);
    background: color-mix(
      in srgb,
      var(--vscode-charts-yellow) 16%,
      transparent
    );
  }

  /* ── Expanded row detail ── */
  .detail-panel {
    grid-column: 1 / -1;
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .detail-block {
    font-size: 12px;
  }
  .detail-block h4 {
    font-size: 10px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    font-weight: 700;
    margin: 0 0 6px;
    color: var(--vscode-editorLineNumber-foreground);
  }
  .detail-block pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    text-align: center;
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground, #888);
  }
`
