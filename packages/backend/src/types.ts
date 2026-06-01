export const WDIO_CONFIG_FILENAMES = [
  'wdio.conf.ts',
  'wdio.conf.js',
  'wdio.conf.cjs',
  'wdio.conf.mjs'
] as const

export const NIGHTWATCH_CONFIG_FILENAMES = [
  'nightwatch.conf.cjs',
  'nightwatch.conf.js',
  'nightwatch.conf.ts',
  'nightwatch.conf.mjs',
  'nightwatch.json'
] as const

export type { RunnerRequestBody } from '@wdio/devtools-shared'
