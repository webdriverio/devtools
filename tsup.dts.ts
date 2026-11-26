// The private workspace packages are never published, so a package's declarations must declare their types rather than import them.

const PRIVATE_PACKAGES = ['shared', 'core', 'trace'] as const

/** tsup's `dts` option for a package under `packages/<name>/`: resolve the private packages to their sources so their types are inlined. */
export const INLINE_PRIVATE_TYPES = {
  compilerOptions: {
    baseUrl: '../..',
    rootDir: '../..',
    module: 'esnext',
    moduleResolution: 'bundler',
    paths: Object.fromEntries(
      PRIVATE_PACKAGES.flatMap((name) => [
        [`@wdio/devtools-${name}`, [`packages/${name}/src/index.ts`]],
        [`@wdio/devtools-${name}/*`, [`packages/${name}/src/*`]]
      ])
    )
  }
}
