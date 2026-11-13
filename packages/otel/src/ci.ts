type Env = Record<string, string | undefined>
type Attributes = Record<string, string>
type Rule = [key: string, value: (env: Env) => string | undefined]

const CICD_PIPELINE_NAME = 'cicd.pipeline.name'
const CICD_PIPELINE_RUN_ID = 'cicd.pipeline.run.id'
const CICD_PIPELINE_RUN_URL_FULL = 'cicd.pipeline.run.url.full'
const VCS_REF_HEAD_NAME = 'vcs.ref.head.name'
const VCS_REF_HEAD_REVISION = 'vcs.ref.head.revision'

const firstSet = (...values: (string | undefined)[]): string | undefined =>
  values.find((value) => value !== undefined && value !== '')

const githubRunUrl = (env: Env): string | undefined =>
  env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : undefined

const GITHUB_RULES: Rule[] = [
  [CICD_PIPELINE_NAME, (env) => env.GITHUB_WORKFLOW],
  [CICD_PIPELINE_RUN_ID, (env) => env.GITHUB_RUN_ID],
  [CICD_PIPELINE_RUN_URL_FULL, githubRunUrl],
  [
    VCS_REF_HEAD_NAME,
    (env) => firstSet(env.GITHUB_HEAD_REF, env.GITHUB_REF_NAME)
  ],
  [VCS_REF_HEAD_REVISION, (env) => env.GITHUB_SHA]
]

const GITLAB_RULES: Rule[] = [
  [
    CICD_PIPELINE_NAME,
    (env) => firstSet(env.CI_PIPELINE_NAME, env.CI_PROJECT_PATH)
  ],
  [CICD_PIPELINE_RUN_ID, (env) => env.CI_PIPELINE_ID],
  [CICD_PIPELINE_RUN_URL_FULL, (env) => env.CI_PIPELINE_URL],
  [
    VCS_REF_HEAD_NAME,
    (env) =>
      firstSet(env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME, env.CI_COMMIT_REF_NAME)
  ],
  [VCS_REF_HEAD_REVISION, (env) => env.CI_COMMIT_SHA]
]

function applyRules(rules: Rule[], env: Env): Attributes {
  return Object.fromEntries(
    rules.flatMap(([key, value]) => {
      const resolved = firstSet(value(env))
      return resolved === undefined ? [] : [[key, resolved]]
    })
  )
}

export function ciResourceAttributes(env: Env): Attributes {
  if (env.GITHUB_ACTIONS === 'true') {
    return applyRules(GITHUB_RULES, env)
  }
  if (env.GITLAB_CI === 'true') {
    return applyRules(GITLAB_RULES, env)
  }
  return {}
}
