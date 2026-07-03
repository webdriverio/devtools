import { css } from 'lit'

/** Host layout for the trace-player timeline strip. */
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
`
