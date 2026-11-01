export abstract class Collector<Artifact> {
  abstract getArtifacts(): Artifact[]
  abstract clear(): void
}
