import { css } from 'lit'

export const sourceStyles = css`
  :host {
    display: flex;
    width: 100%;
    height: 100%;
  }

  .source-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .src-toolbar {
    flex: none;
    background: var(--vscode-sideBar-background);
  }
  .src-files {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 5px 8px 0;
    overflow-x: auto;
    scrollbar-width: thin;
    background: color-mix(
      in srgb,
      var(--vscode-foreground) 4%,
      var(--vscode-editor-background)
    );
  }

  .src-file {
    position: relative;
    z-index: 0;
    display: flex;
    align-items: center;
    flex: none;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    border: none;
    outline: none;
    border-radius: 8px;
    padding: 6px 14px;
    margin-bottom: 3px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .src-file:hover:not(.active) {
    color: var(--vscode-foreground);
    background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  }

  .src-file.active {
    z-index: 1;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    border-radius: 8px 8px 0 0;
    /* top stays aligned with the floating capsules; the extra bottom padding
       (= the capsules' 4px margin) extends the tab down to the editor. */
    margin-bottom: 0;
    padding-bottom: 10px;
  }

  .src-file.active::before,
  .src-file.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 8px;
    height: 8px;
  }
  .src-file.active::before {
    left: -8px;
    background: radial-gradient(
      circle at top left,
      transparent 8px,
      var(--vscode-editor-background) 8px
    );
  }
  .src-file.active::after {
    right: -8px;
    background: radial-gradient(
      circle at top right,
      transparent 8px,
      var(--vscode-editor-background) 8px
    );
  }

  .src-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 12px;
    background: var(--vscode-editor-background);
  }
  .src-path {
    display: flex;
    align-items: center;
    min-width: 0;
    overflow: hidden;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .src-path .sep {
    opacity: 0.5;
    padding: 0 2px;
  }
  .src-path .base {
    color: var(--vscode-foreground);
    font-weight: 600;
  }

  .cs-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-foreground);
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid var(--vscode-panel-border);
    background: color-mix(in srgb, var(--cs) 14%, transparent);
    cursor: pointer;
  }
  .cs-chip:hover {
    border-color: var(--cs);
  }
  .cs-chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs);
    flex: none;
  }
  .cs-chip .cmd {
    font-weight: 600;
  }
  .cs-chip .ln {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
  }

  .src-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .src-act {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    text-decoration: none;
    background: transparent;
    border: 1px solid var(--vscode-panel-border);
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .src-act:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground);
  }

  .source-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .cm-editor {
    width: 100%;
    height: 100%;
    padding: 10px 0px;
    font-size: 12.5px;
  }
  .cm-content {
    padding: 0 !important;
  }

  .cm-editor,
  .cm-gutters {
    background-color: var(--vscode-editor-background) !important;
    border: none !important;
  }

  .cm-callsite {
    background-color: color-mix(in srgb, var(--cs) 16%, transparent) !important;
    box-shadow: inset 3px 0 0 var(--cs);
  }
`
