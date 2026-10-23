import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PYTHON_OPTIONS } from '../src/capability-options.js'
import { REPO_ROOT } from '../src/constants.js'

const PKG = path.join(
  REPO_ROOT,
  'packages/selenium-devtools-py/src/selenium_devtools'
)
const hasPython = spawnSync('python3', ['--version']).status === 0

// Parsed with Python's own ast rather than imported, so the check needs no selenium install.
const READ_OPTIONS = `
import ast, json, sys
init, plugin, constants = sys.argv[1:4]

def tree(path):
    return ast.parse(open(path).read())

enable = next((n for n in ast.walk(tree(init))
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "enable"), None)
if enable is None:
    sys.exit("enable() not found in " + init)
a = enable.args
names = [p.arg for p in a.posonlyargs + a.args + a.kwonlyargs]
names += ["*" + a.vararg.arg] if a.vararg else []
names += ["**" + a.kwarg.arg] if a.kwarg else []

for call in ast.walk(tree(plugin)):
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)):
        continue
    strings = [x.value for x in call.args if isinstance(x, ast.Constant) and isinstance(x.value, str)]
    if call.func.attr == "addoption":
        longs = [s for s in strings if s.startswith("--")]
        names += longs or strings
    elif call.func.attr == "addini" and strings:
        names.append(strings[0])

for node in tree(constants).body:
    if (isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str) and node.value.value.startswith("DEVTOOLS_")
            and any(isinstance(t, ast.Name) and t.id.startswith("ENV_") for t in node.targets)):
        names.append(node.value.value)

print(json.dumps(names))
`

function pythonOptions(): string[] {
  const run = spawnSync(
    'python3',
    [
      '-I',
      '-c',
      READ_OPTIONS,
      path.join(PKG, '__init__.py'),
      path.join(PKG, 'pytest_plugin.py'),
      path.join(PKG, 'constants.py')
    ],
    { encoding: 'utf8' }
  )
  if (run.status !== 0) {
    throw new Error(
      `could not read the Python adapter's options: ${run.stderr}`
    )
  }
  return JSON.parse(run.stdout) as string[]
}

describe('Python adapter options', () => {
  it.skipIf(!hasPython)(
    'maps every enable() keyword, pytest option and DEVTOOLS_* variable, and nothing else',
    () => {
      const found = [...new Set(pythonOptions())].sort()
      expect(found.length).toBeGreaterThan(10)
      expect(Object.keys(PYTHON_OPTIONS).sort()).toEqual(found)
    }
  )
})
