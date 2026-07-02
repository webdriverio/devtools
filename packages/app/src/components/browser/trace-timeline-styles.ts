import { css } from 'lit'

/** Styles for the trace-player timeline strip: host layout + hidden scrollbars. */
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
`
