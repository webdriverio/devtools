import { css, unsafeCSS } from 'lit'

import { BROWSER_BACKDROP_GRADIENT } from '../../controller/constants.js'

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
    background: ${unsafeCSS(BROWSER_BACKDROP_GRADIENT)};
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

  /* Device frame: the header states what the capture came off, in place of an
     address bar a native session could only have filled with "unknown".
     NB: no backticks in this file — the rules live in a tagged template. */
  .device-chrome {
    padding: 0.45rem 0.25rem;
    gap: 0.5rem;
  }

  .device-label {
    flex: 1;
    min-width: 0;
    padding-left: 0.5rem;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--vscode-descriptionForeground, #ccc);
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

  /* The capture fills the pane and contains inside it — the same fit as the
     screencast branch. Bounding the width alone scaled a portrait capture up to
     the pane width, overflowed its height, and the wrapper's overflow:hidden
     clipped the remainder: a 1206x2622 phone screen showed 17% of itself at
     5.9x in a 1240x457 pane. */
  .screenshot-overlay img {
    width: 100%;
    height: 100%;
    object-fit: contain;
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

  /* DOM-replay only: centre the viewport-sized sizer; below-the-fold content
     scrolls INSIDE the iframe (native page scrollbar), so the player itself
     never scrolls and no gutter appears beside the page. Not applied to the
     screenshot / screencast branches, which rely on full-width children. */
  .iframe-wrapper--replay {
    align-items: center;
  }

  /* In-flow box sized (inline) to the scaled iframe footprint, giving the
     absolutely-positioned scaled iframe (zero footprint on its own) something
     for the wrapper's align-items to centre. */
  .iframe-sizer {
    position: relative;
    flex: none;
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
