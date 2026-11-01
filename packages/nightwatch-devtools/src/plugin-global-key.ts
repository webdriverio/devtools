/**
 * Global key the plugin uses to hand itself to the Cucumber hooks
 * (`helpers/cucumberHooks.cts`). Single source of truth, re-exported by
 * `constants.ts`.
 *
 * It lives in its own leaf module with NO imports on purpose: the Cucumber
 * hooks are bundled standalone into a CJS file, and importing this from the
 * full `constants.ts` would drag in its ESM dependency graph (→ core), which
 * uses `import.meta.url` / `createRequire` and throws when bundled to CJS.
 */
export const PLUGIN_GLOBAL_KEY = '__nightwatchDevtoolsPlugin'
