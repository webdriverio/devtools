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

export interface RunnerRequestBody {
  uid: string
  entryType: 'suite' | 'test'
  specFile?: string
  fullTitle?: string
  label?: string
  callSource?: string
  runAll?: boolean
  framework?: string
  configFile?: string
  lineNumber?: number
  devtoolsHost?: string
  devtoolsPort?: number
  featureFile?: string
  featureLine?: number
  suiteType?: string
}
