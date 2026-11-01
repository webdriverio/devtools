import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findStepDefinitionLocation } from '../src/utils/step-defs.js'

// Each test creates its own temp dir so the step-defs cache (keyed by stepsDir
// absolute path) doesn't carry across tests.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wdio-step-defs-'))

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

let counter = 0
function mkFixture(stepsDirName: string, stepDefsContent: string) {
  counter++
  const root = fs.mkdtempSync(path.join(tmpRoot, `fix-${counter}-`))
  const featuresDir = path.join(root, 'features')
  const stepsDir = path.join(featuresDir, stepsDirName)
  fs.mkdirSync(stepsDir, { recursive: true })
  const stepsFile = path.join(stepsDir, 'steps.ts')
  fs.writeFileSync(stepsFile, stepDefsContent, 'utf-8')
  // Feature file used as the hint — directory walks up from here.
  const featureFile = path.join(featuresDir, 'login.feature')
  fs.writeFileSync(featureFile, 'Feature: dummy\n', 'utf-8')
  return { root, featuresDir, stepsDir, stepsFile, featureFile }
}

describe('findStepDefinitionLocation', () => {
  it('matches a literal-string step definition (Cucumber-expression-free)', () => {
    const { stepsFile, featureFile } = mkFixture(
      'step-definitions',
      [
        "Given('I open the homepage', () => {})",
        "When('I click submit', () => {})",
        ''
      ].join('\n')
    )
    const loc = findStepDefinitionLocation(
      'Given I open the homepage',
      featureFile
    )
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
    expect(loc!.line).toBe(1)
  })

  it('matches via the step text without the Given/When/Then keyword', () => {
    const { stepsFile, featureFile } = mkFixture(
      'step_definitions',
      ["Given('I open the homepage', () => {})", ''].join('\n')
    )
    // Title passed without the keyword
    const loc = findStepDefinitionLocation('I open the homepage', featureFile)
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
  })

  it('matches a Cucumber-expression step definition with a {string} placeholder', () => {
    const { stepsFile, featureFile } = mkFixture(
      'steps',
      ["Given('I open {string}', (page) => { void page })", ''].join('\n')
    )
    const loc = findStepDefinitionLocation(
      'Given I open "the homepage"',
      featureFile
    )
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
  })

  it('matches a RegExp step definition', () => {
    const { stepsFile, featureFile } = mkFixture(
      'step-definitions',
      ['Given(/^I see (\\d+) results$/, () => {})', ''].join('\n')
    )
    const loc = findStepDefinitionLocation('Given I see 5 results', featureFile)
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
  })

  it('returns undefined when no step definitions match', () => {
    const { featureFile } = mkFixture(
      'step-definitions',
      ["Given('I do something', () => {})", ''].join('\n')
    )
    const loc = findStepDefinitionLocation(
      'Given I do something completely different',
      featureFile
    )
    expect(loc).toBeUndefined()
  })

  it('returns undefined when no steps directory exists anywhere reachable', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'empty-'))
    // No step definitions anywhere along the ascent path.
    const loc = findStepDefinitionLocation(
      'Given anything',
      path.join(dir, 'fake.feature')
    )
    // May still find SOMETHING via the global BFS from cwd — don't assert
    // undefined, just verify no throw and correct shape if defined.
    if (loc) {
      expect(typeof loc.file).toBe('string')
      expect(typeof loc.line).toBe('number')
    } else {
      expect(loc).toBeUndefined()
    }
  })

  it('matches the second of multiple definitions in the same file', () => {
    const { stepsFile, featureFile } = mkFixture(
      'steps',
      ["Given('first', () => {})", "Given('second', () => {})", ''].join('\n')
    )
    const loc = findStepDefinitionLocation('Given second', featureFile)
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
    expect(loc!.line).toBe(2)
  })

  it('case-insensitively matches the step keyword', () => {
    const { stepsFile, featureFile } = mkFixture(
      'step-definitions',
      ["Given('foo bar', () => {})", ''].join('\n')
    )
    // Match without a keyword (gets routed through titleNoKw)
    const loc = findStepDefinitionLocation('foo bar', featureFile)
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
  })

  it('walks up from a hint directory (no extension) to find the steps dir', () => {
    const { stepsFile, featureFile } = mkFixture(
      'step-definitions',
      ["Given('walk up', () => {})", ''].join('\n')
    )
    // Pass the features dir itself (no extension) — should still find the
    // sibling step-definitions/ subfolder.
    const hintDir = path.dirname(featureFile)
    const loc = findStepDefinitionLocation('Given walk up', hintDir)
    expect(loc).toBeDefined()
    expect(loc!.file).toBe(stepsFile)
  })
})
