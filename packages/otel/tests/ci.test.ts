import { describe, expect, it } from 'vitest'
import {
  ATTR_CICD_PIPELINE_NAME,
  ATTR_CICD_PIPELINE_RUN_ID,
  ATTR_CICD_PIPELINE_RUN_URL_FULL,
  ATTR_VCS_REF_HEAD_NAME,
  ATTR_VCS_REF_HEAD_REVISION
} from '@opentelemetry/semantic-conventions/incubating'
import { ciResourceAttributes } from '../src/ci.js'

const GITHUB = {
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKFLOW: 'e2e',
  GITHUB_RUN_ID: '7',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'org/repo',
  GITHUB_SHA: 'abc',
  GITHUB_REF_NAME: 'main'
}

const GITLAB = {
  GITLAB_CI: 'true',
  CI_PROJECT_PATH: 'org/repo',
  CI_PIPELINE_ID: '42',
  CI_PIPELINE_URL: 'https://gitlab.example/org/repo/-/pipelines/42',
  CI_COMMIT_REF_NAME: 'main',
  CI_COMMIT_SHA: 'def'
}

describe('semantic convention keys', () => {
  it('match the installed semantic conventions', () => {
    expect([
      ATTR_CICD_PIPELINE_NAME,
      ATTR_CICD_PIPELINE_RUN_ID,
      ATTR_CICD_PIPELINE_RUN_URL_FULL,
      ATTR_VCS_REF_HEAD_NAME,
      ATTR_VCS_REF_HEAD_REVISION
    ]).toEqual([
      'cicd.pipeline.name',
      'cicd.pipeline.run.id',
      'cicd.pipeline.run.url.full',
      'vcs.ref.head.name',
      'vcs.ref.head.revision'
    ])
  })
})

describe('ciResourceAttributes', () => {
  it('maps a GitHub Actions run', () => {
    expect(ciResourceAttributes(GITHUB)).toEqual({
      'cicd.pipeline.name': 'e2e',
      'cicd.pipeline.run.id': '7',
      'cicd.pipeline.run.url.full':
        'https://github.com/org/repo/actions/runs/7',
      'vcs.ref.head.name': 'main',
      'vcs.ref.head.revision': 'abc'
    })
  })

  it('prefers the pull request head ref on GitHub', () => {
    expect(
      ciResourceAttributes({
        ...GITHUB,
        GITHUB_HEAD_REF: 'feature',
        GITHUB_REF_NAME: '7/merge'
      })['vcs.ref.head.name']
    ).toBe('feature')
  })

  it('maps a GitLab CI pipeline', () => {
    expect(ciResourceAttributes(GITLAB)).toEqual({
      'cicd.pipeline.name': 'org/repo',
      'cicd.pipeline.run.id': '42',
      'cicd.pipeline.run.url.full':
        'https://gitlab.example/org/repo/-/pipelines/42',
      'vcs.ref.head.name': 'main',
      'vcs.ref.head.revision': 'def'
    })
  })

  it('prefers the merge request source branch and pipeline name on GitLab', () => {
    expect(
      ciResourceAttributes({
        ...GITLAB,
        CI_PIPELINE_NAME: 'nightly',
        CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature'
      })
    ).toMatchObject({
      'cicd.pipeline.name': 'nightly',
      'vcs.ref.head.name': 'feature'
    })
  })

  it('returns nothing outside a known CI', () => {
    expect(ciResourceAttributes({ PATH: '/bin', GITHUB_SHA: 'abc' })).toEqual(
      {}
    )
  })

  it('omits the run url unless the server, repository and run id are all set', () => {
    const { GITHUB_SERVER_URL: _server, ...partial } = GITHUB
    expect(ciResourceAttributes(partial)).not.toHaveProperty(
      'cicd.pipeline.run.url.full'
    )
  })

  it('omits each attribute whose variable is unset or empty', () => {
    expect(
      ciResourceAttributes({
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: '',
        GITHUB_RUN_ID: '7'
      })
    ).toEqual({ 'cicd.pipeline.run.id': '7' })
  })
})
