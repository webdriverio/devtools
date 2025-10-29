import fs from 'node:fs'

/**
 * parse `./src/core/colors.css` and apply them to the theme
 */
const cssContent = fs.readFileSync('./src/core/colors.css', 'utf-8')
const cssVars = cssContent
  .match(/--vscode-[^:]+/g)
  .map((c) => [
    c,
    c.slice('--vscode-'.length).replace(/-(\w)/g, (_, m) => m.toUpperCase())
  ])
  .reduce((acc, [key, value]) => {
    acc[value] = `var(${key})`
    return acc
  }, {})

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', ':host-context(.dark)'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',

      wdio: '#ea5907',
      ...cssVars
    }
  },
  plugins: []
}
