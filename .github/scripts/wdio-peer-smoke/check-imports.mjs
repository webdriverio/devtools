import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const major = process.argv[2]

function installedVersions(name) {
  // npm ls exits non-zero on any tree problem, but still prints the tree.
  let out
  try {
    out = execFileSync('npm', ['ls', name, '--all', '--json'], {
      encoding: 'utf8'
    })
  } catch (err) {
    out = err.stdout
  }
  const versions = new Set()
  const walk = (deps = {}) => {
    for (const [dep, info] of Object.entries(deps)) {
      if (dep === name && info.version) {
        versions.add(info.version)
      }
      walk(info.dependencies)
    }
  }
  walk(JSON.parse(out).dependencies)
  return [...versions]
}

async function checkEntryPoints() {
  const service = await import('@wdio/devtools-service')
  assert.equal(typeof service.default, 'function', 'service default export')
  assert.equal(typeof service.launcher, 'function', 'service launcher export')
  assert.equal(typeof service.setupForDevtools, 'function', 'standalone export')

  const { DevToolsAppLauncher } =
    await import('@wdio/devtools-service/launcher')
  assert.equal(typeof DevToolsAppLauncher, 'function', 'launcher entry')
  await import('@wdio/devtools-service/types')

  const elements = await import('@wdio/elements')
  for (const fn of [
    'getSnapshot',
    'getElements',
    'getBrowserAccessibilityTree'
  ]) {
    assert.equal(typeof elements[fn], 'function', `@wdio/elements ${fn}`)
  }
  const locators = await import('@wdio/elements/locators')
  assert.equal(typeof locators.xmlToJSON, 'function', '@wdio/elements/locators')
}

const webdriverio = installedVersions('webdriverio')
assert.deepEqual(
  webdriverio.map((v) => v.split('.')[0]),
  [major],
  `expected one webdriverio@${major}, found ${webdriverio.join(', ')}`
)

checkEntryPoints().then(() => {
  // Informational: the service pins these exactly, so a newer major runs with
  // a second copy of each. Printed so the CI log shows what a user installs.
  for (const name of ['@wdio/reporter', '@wdio/types', '@wdio/logger']) {
    console.log(`${name}: ${installedVersions(name).join(', ')}`)
  }
  console.log(`webdriverio ${webdriverio[0]}: entry points import`)
})
