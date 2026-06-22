import { css } from 'lit'

/** Component styles for `<wdio-devtools-snapshot>`. Pulled out of snapshot.ts
 *  so the main component file stays focused on the iframe/screencast logic. */
export const snapshotStyles = css`
  :host {
    width: 100%;
    height: 100%;
    display: flex;
    padding: 1.25rem !important;
    align-items: center;
    justify-content: center;
    box-sizing: border-box !important;
    background: radial-gradient(
      120% 120% at 50% 0%,
      var(--vscode-editorWidget-background),
      var(--vscode-editor-background)
    );
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
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.45),
      0 0 60px color-mix(in srgb, var(--accent) 12%, transparent);
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
    border-radius: 0 0 14px 14px;
  }

  .screenshot-overlay {
    position: absolute;
    inset: 0;
    background: var(--vscode-editor-background, #111);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-radius: 0 0 14px 14px;
    overflow: hidden;
  }

  .screenshot-overlay img {
    max-width: 100%;
    height: auto;
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

  /* Segmented control like the mockup: the border lives on the group; the
     buttons are borderless pills inside a small inset. */
  .view-toggle {
    display: flex;
    gap: 0;
    margin-left: 0.5rem;
    flex-shrink: 0;
    padding: 2px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-input-background);
  }

  .view-toggle button {
    padding: 5px 11px;
    min-width: 78px;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    border: none;
    outline: none;
    background: transparent;
    color: var(--vscode-descriptionForeground, #ccc);
    cursor: pointer;
    border-radius: 6px;
    line-height: 1;
    transition:
      background-color 0.18s ease,
      color 0.18s ease;
  }

  .view-toggle button:hover {
    color: var(--vscode-foreground);
  }

  .view-toggle button.active {
    background: var(--accent, #ff7a3c);
    color: var(--accent-foreground, #0d0f12);
  }

  .view-toggle button.active:hover {
    color: var(--accent-foreground, #0d0f12);
  }

  .video-select {
    font-size: 11px;
    font-family: inherit;
    padding: 5px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-foreground);
    cursor: pointer;
    line-height: 1;
    margin-left: 6px;
  }
  /* kept visible (greyed) in snapshot mode so the toggle cluster doesn't change
     width when switching modes */
  .video-select:disabled {
    opacity: 0.4;
    cursor: default;
  }
`
