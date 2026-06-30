import { css } from 'lit'

/** Styles for the trace-player timeline: host layout, hidden scrollbars, and
 *  the network-detail drawer. Detail-block styles come from networkStyles. */
export const timelineStyles = css`
  :host {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background-color: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }
  .no-scrollbar {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .net-drawer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 62%;
    display: flex;
    flex-direction: column;
    background: var(--vscode-sideBar-background);
    border-top: 1px solid var(--accent, #ff7a3c);
    box-shadow: 0 -16px 40px -24px #000;
    z-index: 30;
  }
  .net-drawer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 12px;
  }
  .net-drawer-head .url {
    font-family: monospace;
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
  }
  .net-drawer-head .close {
    margin-left: auto;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .net-drawer-head .close:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }
  .net-drawer-body {
    overflow: auto;
    padding: 4px 0;
  }
`
