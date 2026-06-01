import { css } from 'lit'

/** Component styles for `<wdio-devtools-snapshot>`. Pulled out of snapshot.ts
 *  so the main component file stays focused on the iframe/screencast logic. */
export const snapshotStyles = css`
  :host {
    width: 100%;
    height: 100%;
    display: flex;
    padding: 2rem !important;
    align-items: center;
    justify-content: center;
    box-sizing: border-box !important;
  }

  section {
    box-sizing: border-box;
    width: calc(100% - 0px); /* host padding already applied */
    height: calc(100% - 0px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--vscode-sideBar-background);
    padding: 0.5rem;
    gap: 0;
  }

  .frame-dot {
    border-radius: 50%;
    height: 12px;
    width: 12px;
    margin: 1em 0.25em;
    flex-shrink: 0;
  }

  .frame-dot:nth-child(1) {
    background-color: var(--vscode-notificationsErrorIcon-foreground, #e51400);
  }

  .frame-dot:nth-child(2) {
    background-color: var(
      --vscode-notificationsWarningIcon-foreground,
      #bf8803
    );
  }

  .frame-dot:nth-child(3) {
    background-color: var(--vscode-ports-iconRunningProcessForeground, #369432);
  }

  iframe {
    background-color: white;
    position: absolute;
    top: 0;
    left: 0;
    border: none;
    border-radius: 0 0 0.5rem 0.5rem;
  }

  .screenshot-overlay {
    position: absolute;
    inset: 0;
    background: #111;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-radius: 0 0 0.5rem 0.5rem;
    overflow: hidden;
  }

  .screenshot-overlay img {
    max-width: 100%;
    height: auto;
    display: block;
  }

  .screencast-player {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #111;
    border-radius: 0 0 0.5rem 0.5rem;
    display: block;
  }

  .iframe-wrapper {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .view-toggle {
    display: flex;
    gap: 2px;
    margin-left: 0.5rem;
    flex-shrink: 0;
  }

  .view-toggle button {
    padding: 2px 10px;
    font-size: 11px;
    font-family: inherit;
    border: 1px solid var(--vscode-editorSuggestWidget-border, #454545);
    background: transparent;
    color: var(--vscode-input-foreground, #ccc);
    cursor: pointer;
    border-radius: 3px;
    line-height: 20px;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .view-toggle button.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border-color: transparent;
  }

  .video-select {
    font-size: 11px;
    font-family: inherit;
    padding: 2px 4px;
    border: 1px solid var(--vscode-dropdown-border, #454545);
    border-radius: 3px;
    background: var(--vscode-dropdown-background, #3c3c3c);
    color: var(--vscode-dropdown-foreground, #ccc);
    cursor: pointer;
    line-height: 20px;
    margin-left: 4px;
  }
`
