import { createRequire } from 'node:module'

export function detectOwnVersion(): string {
  try {
    return createRequire(import.meta.url)('../../package.json').version
  } catch {
    return 'unknown'
  }
}

export function detectRunner(): string {
  const argv = (process.argv[1] || '').toLowerCase()
  if (argv.includes('mocha')) {
    return 'mocha'
  }
  if (argv.includes('jest')) {
    return 'jest'
  }
  if (argv.includes('jasmine')) {
    return 'jasmine'
  }
  if (argv.includes('vitest')) {
    return 'vitest'
  }
  if (argv.includes('cucumber')) {
    return 'cucumber'
  }
  if (argv.endsWith('node') || argv.endsWith('node.exe')) {
    return 'node'
  }
  return 'unknown'
}

export function detectSeleniumVersion(): string | undefined {
  const tryRead = (req: NodeRequire): string | undefined => {
    try {
      return req('selenium-webdriver/package.json').version
    } catch {
      return undefined
    }
  }
  const fromUser = tryRead(createRequire(`${process.cwd()}/`))
  if (fromUser) {
    return fromUser
  }
  return tryRead(createRequire(import.meta.url))
}
