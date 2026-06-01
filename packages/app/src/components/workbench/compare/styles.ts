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
  .compare-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    /* Stack rows from the top so they don't stretch to fill the grid. */
    align-content: start;
    grid-auto-rows: min-content;
  }
  .step-row {
    display: contents;
  }
  .step-cell {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    cursor: pointer;
  }
  .step-cell.divergent {
    background: rgba(255, 90, 90, 0.08);
  }
  .step-cell.divergent.first {
    background: rgba(255, 90, 90, 0.18);
    border-left: 3px solid var(--vscode-charts-red, #f48771);
  }
  .marker {
    margin-left: 0.35rem;
    font-size: 0.85em;
  }
  .marker.result {
    color: var(--vscode-charts-orange, #d19a66);
  }
  .marker.error {
    color: var(--vscode-charts-red, #f48771);
  }
  .marker.command {
    color: var(--vscode-charts-red, #f48771);
  }
  .marker.ok {
    color: var(--vscode-charts-green, #73c373);
  }
  .marker.info {
    color: var(--vscode-descriptionForeground, #999);
    opacity: 0.7;
  }
  .error-banner {
    margin: 0.5rem 0.75rem;
    padding: 0.5rem 0.75rem;
    background: rgba(244, 135, 113, 0.12);
    border-left: 3px solid var(--vscode-charts-red, #f48771);
    border-radius: 3px;
    font-size: 0.85em;
  }
  .error-banner-title {
    font-weight: 600;
    margin-bottom: 0.25rem;
    opacity: 0.85;
    font-family: inherit;
  }
  /* Pre-wrap only on the message body so template indentation doesn't render. */
  .error-banner-message {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  .step-cell.missing {
    opacity: 0.35;
    font-style: italic;
  }
  .step-cell:hover {
    background: var(
      --vscode-toolbar-hoverBackground,
      rgba(255, 255, 255, 0.06)
    );
  }
  .step-cell.expanded {
    background: rgba(80, 160, 255, 0.06);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85em;
    background: var(--vscode-badge-background, #2a2a2a);
  }
  .pill.failed {
    background: rgba(244, 135, 113, 0.2);
    color: var(--vscode-charts-red, #f48771);
  }
  .pill.passed {
    background: rgba(115, 195, 115, 0.2);
    color: var(--vscode-charts-green, #73c373);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
    flex: 0 0 auto;
  }
  .col-header {
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background, #1e1e1e);
    z-index: 1;
    padding: 0.5rem;
    font-weight: 600;
    font-size: 0.85em;
    border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  }
  .detail-panel {
    grid-column: span 2;
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
    padding: 0.5rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .detail-block {
    font-size: 0.85em;
  }
  .detail-block h4 {
    font-size: 0.85em;
    margin: 0 0 0.25rem;
    opacity: 0.7;
    font-weight: 600;
  }
  .detail-block pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85em;
    background: rgba(255, 255, 255, 0.03);
    padding: 0.25rem 0.4rem;
    border-radius: 3px;
  }
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 0.9em;
    text-align: center;
    padding: 1rem;
  }
  .toggle-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
    font-size: 0.85em;
  }
  button.action {
    background: transparent;
    border: 1px solid var(--vscode-panel-border, #2a2a2a);
    color: inherit;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
  }
  button.action:hover {
    background: var(
      --vscode-toolbar-hoverBackground,
      rgba(255, 255, 255, 0.06)
    );
  }
  button.action.icon-only {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.4rem;
  }
  button.action.icon-only svg {
    width: 1em;
    height: 1em;
  }
`
