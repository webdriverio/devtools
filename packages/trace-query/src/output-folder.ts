import fs from 'node:fs/promises'
import path from 'node:path'
import { isArtifactsManifestFilename } from '@wdio/devtools-shared'
import {
  parseArtifactsManifest,
  type ParsedManifest,
  type ParsedManifestTest
} from '@wdio/devtools-trace/artifacts-manifest-reader'
import {
  finalAttemptOf,
  sharesTraceArtifact,
  traceArtifactFor
} from '@wdio/devtools-trace/final-attempt-artifacts'
import {
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_ENTRIES,
  MAX_LISTED,
  MAX_MANIFEST_BYTES
} from './constants.js'
import { guardedRealPath } from './local-paths.js'
import type { TraceSelection, TraceTarget } from './types.js'

export interface FolderTrace {
  zipPath: string
  test?: TraceSelection
}

interface ManifestTest {
  dir: string
  manifest: ParsedManifest
  test: ParsedManifestTest
}

function listed(lines: string[]): string {
  const shown = lines.slice(0, MAX_LISTED).map((line) => `  - ${line}`)
  const more =
    lines.length > MAX_LISTED
      ? [`  - and ${lines.length - MAX_LISTED} more`]
      : []
  return [...shown, ...more].join('\n')
}

function describeTest({ manifest, test }: ManifestTest): string {
  return `${test.uid} (${test.title}, ${test.specFile}, ${test.state ?? 'no outcome'}, session ${manifest.sessionId})`
}

async function readManifest(file: string): Promise<ParsedManifest> {
  const { size } = await fs.stat(file)
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(
      `${file} is larger than the ${MAX_MANIFEST_BYTES}-byte limit for an artifacts manifest`
    )
  }
  let json: unknown
  try {
    json = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    // The parser's message quotes the file, which need not be a manifest at all.
    throw new Error(`${file} is not a JSON artifacts manifest`)
  }
  return parseArtifactsManifest(json, file)
}

// Only regular files: a manifest-named symlink could point anywhere, and only the folder was checked against the roots.
async function readManifests(dir: string): Promise<ParsedManifest[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && isArtifactsManifestFilename(entry.name)
      )
      .map((entry) => readManifest(path.join(dir, entry.name)))
  )
}

function matchesTarget(entry: ManifestTest, target: TraceTarget): boolean {
  return (
    entry.test.uid === target.uid &&
    (target.specFile === undefined ||
      entry.test.specFile === target.specFile) &&
    (target.sessionId === undefined ||
      entry.manifest.sessionId === target.sessionId)
  )
}

function pickTest(
  dir: string,
  tests: ManifestTest[],
  target: TraceTarget | undefined
): ManifestTest {
  if (!target) {
    if (tests.length === 1) {
      return tests[0]!
    }
    const failedFirst = [...tests].sort(
      (a, b) =>
        Number(b.test.state === 'failed') - Number(a.test.state === 'failed')
    )
    throw new Error(
      `${dir} records ${tests.length} tests; name one by its uid:\n${listed(failedFirst.map(describeTest))}`
    )
  }
  const matches = tests.filter((entry) => matchesTarget(entry, target))
  if (matches.length === 0) {
    throw new Error(
      `No test with uid ${target.uid}${target.specFile ? ` in ${target.specFile}` : ''} in the artifacts manifests in ${dir}`
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `uid ${target.uid} names ${matches.length} tests in ${dir}; give the spec file, or the session for the same test on several browsers:\n${listed(matches.map(describeTest))}`
    )
  }
  return matches[0]!
}

function attemptOf(
  test: ParsedManifestTest,
  target: TraceTarget | undefined
): number {
  const final = finalAttemptOf(test)
  const attempt = target?.attempt ?? final
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > final) {
    throw new Error(
      `"${test.title}" has no attempt ${attempt}; its attempts are 0 to ${final}`
    )
  }
  return attempt
}

// A retry only follows a failure, so an earlier attempt without a record is not reported as anything.
function stateOf(
  test: ParsedManifestTest,
  attempt: number
): string | undefined {
  if (attempt === finalAttemptOf(test)) {
    return test.state
  }
  return test.attempts?.find((record) => record.attempt === attempt)?.state
}

async function zipOf(
  entry: ManifestTest,
  attempt: number,
  allowedRoots: readonly string[]
): Promise<FolderTrace> {
  const { dir, manifest, test } = entry
  const artifact = traceArtifactFor(manifest, test, attempt)
  if (!artifact?.retained) {
    throw new Error(
      `The run kept no trace zip for "${test.title}" attempt ${attempt}; a retain policy such as retain-on-failure drops the traces of passing tests`
    )
  }
  const zipPath = await guardedRealPath(
    path.resolve(dir, artifact.path),
    allowedRoots
  )
  const manifestUids = new Set(manifest.tests.map(({ uid }) => uid))
  return {
    zipPath,
    test: {
      uid: test.uid,
      title: test.title,
      specFile: test.specFile,
      attempt,
      state: stateOf(test, attempt),
      sharedZip: sharesTraceArtifact(artifact, test, manifestUids)
    }
  }
}

async function zipsUnder(root: string): Promise<string[]> {
  const zips: string[] = []
  let visited = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++visited > MAX_FOLDER_ENTRIES) {
        throw new Error(
          `${root} holds more than ${MAX_FOLDER_ENTRIES} entries; open a zip or a smaller folder`
        )
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && depth > 0) {
        await walk(full, depth - 1)
      } else if (entry.isFile() && entry.name.endsWith('.zip')) {
        zips.push(full)
      }
    }
  }
  await walk(root, MAX_FOLDER_DEPTH)
  return zips.sort()
}

async function zipWithoutManifest(
  dir: string,
  target: TraceTarget | undefined
): Promise<FolderTrace> {
  const zips = await zipsUnder(dir)
  if (zips.length === 1 && !target) {
    return { zipPath: zips[0]! }
  }
  if (zips.length === 0) {
    throw new Error(`${dir} holds no artifacts manifest and no trace zip`)
  }
  const reason = target
    ? 'has no artifacts manifest, so a test cannot be found by its uid'
    : `holds ${zips.length} trace zips and no artifacts manifest`
  throw new Error(
    `${dir} ${reason}; open one of its zips:\n${listed(zips.map((zip) => path.relative(dir, zip)))}`
  )
}

/** The zip a folder holds for the target test: through its artifacts manifests when it has any, else its only zip. */
export async function traceInFolder(
  dir: string,
  target: TraceTarget | undefined,
  allowedRoots: readonly string[]
): Promise<FolderTrace> {
  const manifests = await readManifests(dir)
  if (manifests.length === 0) {
    return zipWithoutManifest(dir, target)
  }
  const tests = manifests.flatMap((manifest) =>
    manifest.tests.map((test) => ({ dir, manifest, test }))
  )
  const entry = pickTest(dir, tests, target)
  return zipOf(entry, attemptOf(entry.test, target), allowedRoots)
}
