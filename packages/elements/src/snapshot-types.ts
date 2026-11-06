export type CandidateKind =
  | 'testid'
  | 'role'
  | 'aria'
  | 'id'
  | 'text'
  | 'name'
  | 'aria-label'
  | 'type'
  | 'class'
  | 'xpath-text'
  | 'css-path'
  | 'accessibility-id'
  | 'resource-id'
  | 'predicate'
  | 'class-chain'
  | 'uiautomator'
  | 'xpath'
  | 'tag'
  | 'indexed'

export interface SnapshotCandidate {
  kind: CandidateKind
  selector: string
}

/** Web and native refs carry kind-tagged candidates, best first. */
export interface SnapshotRef {
  id: string
  role: string
  name?: string
  candidates: SnapshotCandidate[]
}

export interface SnapshotNode {
  role: string
  name?: string
  ref?: string
  value?: string
  states?: string[]
  url?: string
  box?: number[]
  note?: string
  hint?: string
  intent?: string
  hidden?: boolean
  interactive?: boolean
  selector?: string
  selectorPositional?: boolean
  children?: SnapshotNode[]
}
