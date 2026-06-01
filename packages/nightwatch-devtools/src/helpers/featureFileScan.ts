import fs from 'fs'
import path from 'node:path'

export interface FeatureFileScan {
  /** Header `Feature:` value, or the filename basename if unreadable. */
  featureName: string
  /** Raw `.feature` file contents (empty when unreadable). */
  featureContent: string
  /** Absolute path to the `.feature` file (resolved from cwd + uri). */
  featureAbsPath: string
  /** Sibling step-definition files (under `step_definitions`/`steps`/`support`). */
  stepDefFiles: Array<{ filePath: string; content: string }>
  /** Paths the caller should feed to `sessionCapturer.captureSource` so the
   *  dashboard's Source panel can render them. */
  capturedPaths: string[]
}

/**
 * Scan a Cucumber feature file and its sibling step-definitions. Pure I/O —
 * the caller invokes `sessionCapturer.captureSource` for each path in
 * `capturedPaths` so this helper stays free of the session capturer.
 */
export function scanFeatureFile(featureUri: string): FeatureFileScan {
  const featureAbsPath = path.resolve(process.cwd(), featureUri)
  const result: FeatureFileScan = {
    featureName: path.basename(featureUri, '.feature'),
    featureContent: '',
    featureAbsPath,
    stepDefFiles: [],
    capturedPaths: []
  }

  if (featureUri === 'unknown.feature' || !fs.existsSync(featureAbsPath)) {
    return result
  }

  result.featureContent = fs.readFileSync(featureAbsPath, 'utf-8')
  const match = result.featureContent.match(/^\s*Feature:\s*(.+)/m)
  if (match) {
    result.featureName = match[1].trim()
  }
  result.capturedPaths.push(featureAbsPath)

  const featureDir = path.dirname(featureAbsPath)
  const stepDirCandidates = ['step_definitions', 'steps', 'support']
  for (const candidate of stepDirCandidates) {
    const stepDir = path.join(featureDir, candidate)
    if (!fs.existsSync(stepDir) || !fs.statSync(stepDir).isDirectory()) {
      continue
    }
    for (const entry of fs.readdirSync(stepDir)) {
      if (!/\.(js|ts|mjs|cjs)$/.test(entry)) {
        continue
      }
      const stepFilePath = path.join(stepDir, entry)
      result.capturedPaths.push(stepFilePath)
      try {
        result.stepDefFiles.push({
          filePath: stepFilePath,
          content: fs.readFileSync(stepFilePath, 'utf-8')
        })
      } catch {
        // skip unreadable files
      }
    }
  }

  return result
}
