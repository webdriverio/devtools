/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        panelBorder: 'var(--vscode-panel-border)',
        editorSuggestWidgetBorder: 'var(--vscode-editorSuggestWidget-border)'
      }
    }
  }
}
