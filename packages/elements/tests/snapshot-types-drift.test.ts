/**
 * `snapshot-types.ts` mirrors @wdio/snapshot's ref vocabulary so the published
 * declarations never reference the optional peer. Compile-time only; the root
 * `pnpm typecheck` enforces it.
 */

import { describe, expectTypeOf, it } from 'vitest'
import type * as Peer from '@wdio/snapshot'
import type {
  CandidateKind,
  SnapshotCandidate,
  SnapshotRef
} from '../src/index.js'

describe('snapshot-types mirror @wdio/snapshot', () => {
  it('matches the peer exactly', () => {
    expectTypeOf<CandidateKind>().toEqualTypeOf<Peer.CandidateKind>()
    expectTypeOf<SnapshotCandidate>().toEqualTypeOf<Peer.SnapshotCandidate>()
    expectTypeOf<SnapshotRef>().toEqualTypeOf<Peer.SnapshotRef>()
  })
})
