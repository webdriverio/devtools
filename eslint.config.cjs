const js = require('@eslint/js')
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const importPlugin = require('eslint-plugin-import')
const unicorn = require('eslint-plugin-unicorn')
const prettierConfig = require('eslint-config-prettier')
const prettierPlugin = require('eslint-plugin-prettier')

module.exports = [
  {
    ignores: ['node_modules/**', '**/dist/**']
  },
  // Base JS config
  {
    ...js.configs.recommended,
    plugins: {
      unicorn,
      import: importPlugin,
      prettier: prettierPlugin
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module'
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': [
        'error',
        {
          bracketSpacing: true,
          semi: false,
          singleQuote: true,
          trailingComma: 'none'
        }
      ],
      quotes: ['error', 'single', { avoidEscape: true }],
      camelcase: ['error', { properties: 'never' }],
      semi: ['error', 'never'],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-multiple-empty-lines': [2, { max: 1, maxEOF: 1 }],
      'array-bracket-spacing': ['error', 'never'],
      'brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'comma-spacing': ['error', { before: false, after: true }],
      'no-lonely-if': 'error',
      'dot-notation': 'error',
      'no-else-return': 'error',
      'no-tabs': 'error',
      'no-trailing-spaces': [
        'error',
        { skipBlankLines: false, ignoreComments: false }
      ],
      'no-var': 'error',
      'unicode-bom': ['error', 'never'],
      curly: ['error', 'all'],
      'object-curly-spacing': ['error', 'always'],
      'keyword-spacing': ['error'],
      'require-atomic-updates': 0,
      'linebreak-style': ['error', 'unix'],
      'import/extensions': ['error', 'ignorePackages'],
      'no-restricted-syntax': [
        'error',
        'IfStatement > ExpressionStatement > AssignmentExpression'
      ]
    }
  },

  // TypeScript files
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    languageOptions: {
      parser: tsParser
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off'
    }
  },

  // Code-quality warnings (CLAUDE.md §3).
  // Kept as `warn` so existing legacy violations surface in IDE/CI without
  // blocking the build. Promote to `error` once known debt (CLAUDE.md §7)
  // is cleared.
  // MUST come before the test-file override block — flat config rule blocks
  // apply in order, so later blocks override earlier ones for matching files.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'max-lines': [
        'warn',
        { max: 500, skipBlankLines: true, skipComments: true }
      ],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }
      ]
    }
  },

  // TypeScript test files — turns off the size rules. MUST come AFTER the
  // production rules block above so the off-rule wins for matching files.
  {
    files: ['**/*.test.ts'],
    rules: {
      'dot-notation': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      // Test fixtures intentionally use `any` to construct partial mocks
      // without restating every field of the real type. The cost of forcing
      // proper types here is high (lots of `as unknown as RealType` casts)
      // and the benefit is low — tests don't ship.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // CLAUDE.md §2.3 — no cross-adapter imports.
  // Adapters (service, nightwatch-devtools, selenium-devtools) own
  // framework-specific glue only. Anything shared between them belongs in
  // packages/core (and is currently duplicated — see CLAUDE.md §7).
  {
    files: ['packages/service/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@wdio/nightwatch-devtools',
                '@wdio/nightwatch-devtools/*'
              ],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            },
            {
              group: ['@wdio/selenium-devtools', '@wdio/selenium-devtools/*'],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/nightwatch-devtools/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wdio/devtools-service', '@wdio/devtools-service/*'],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            },
            {
              group: ['@wdio/selenium-devtools', '@wdio/selenium-devtools/*'],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/selenium-devtools/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wdio/devtools-service', '@wdio/devtools-service/*'],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            },
            {
              group: [
                '@wdio/nightwatch-devtools',
                '@wdio/nightwatch-devtools/*'
              ],
              message:
                'Adapters must not import from each other (CLAUDE.md §2.3). Extract shared logic to packages/core.'
            }
          ]
        }
      ]
    }
  },

  // CLAUDE.md §2.4 — backend does not import from adapters or app.
  // Backend is framework-agnostic; framework branching uses a typed
  // FrameworkId from packages/shared, never adapter internals.
  {
    files: ['packages/backend/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wdio/devtools-service', '@wdio/devtools-service/*'],
              message:
                'Backend must not depend on any adapter (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: [
                '@wdio/nightwatch-devtools',
                '@wdio/nightwatch-devtools/*'
              ],
              message:
                'Backend must not depend on any adapter (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: ['@wdio/selenium-devtools', '@wdio/selenium-devtools/*'],
              message:
                'Backend must not depend on any adapter (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: ['@/*', '@components/*'],
              message:
                'Backend must not import from app (CLAUDE.md §2.4). App talks to backend over WS/HTTP using shared contracts.'
            },
            {
              group: ['@wdio/devtools-core', '@wdio/devtools-core/*'],
              message:
                'Backend must not depend on core (CLAUDE.md §2.2). core is framework-agnostic adapter logic; backend only needs shared contracts.'
            }
          ]
        }
      ]
    }
  },

  // CLAUDE.md §2.4 — app does not import from adapters or backend.
  // App communicates with backend only over WS/HTTP, with contracts
  // defined in packages/shared.
  {
    files: ['packages/app/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wdio/devtools-service', '@wdio/devtools-service/*'],
              message:
                'App must not import from adapters (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: [
                '@wdio/nightwatch-devtools',
                '@wdio/nightwatch-devtools/*'
              ],
              message:
                'App must not import from adapters (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: ['@wdio/selenium-devtools', '@wdio/selenium-devtools/*'],
              message:
                'App must not import from adapters (CLAUDE.md §2.4). Move shared types/constants to packages/shared.'
            },
            {
              group: ['@wdio/devtools-backend', '@wdio/devtools-backend/*'],
              message:
                'App must not import from backend directly (CLAUDE.md §2.4). Communicate via WS/HTTP using shared contracts.'
            },
            {
              group: ['@wdio/devtools-core', '@wdio/devtools-core/*'],
              message:
                'App must not import from core (CLAUDE.md §2.2). core is framework-agnostic adapter logic; the app receives normalized events over WS.'
            }
          ]
        }
      ]
    }
  },

  // CLAUDE.md §2.2 — core is for adapters only. Backend, app, and script
  // must not depend on core. Core itself may only import from shared.
  {
    files: ['packages/core/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wdio/devtools-service', '@wdio/devtools-service/*'],
              message:
                'core must not depend on any adapter (CLAUDE.md §2.2). Adapters import core, not the other way around.'
            },
            {
              group: [
                '@wdio/nightwatch-devtools',
                '@wdio/nightwatch-devtools/*'
              ],
              message:
                'core must not depend on any adapter (CLAUDE.md §2.2). Adapters import core, not the other way around.'
            },
            {
              group: ['@wdio/selenium-devtools', '@wdio/selenium-devtools/*'],
              message:
                'core must not depend on any adapter (CLAUDE.md §2.2). Adapters import core, not the other way around.'
            },
            {
              group: ['@wdio/devtools-backend', '@wdio/devtools-backend/*'],
              message:
                'core must not depend on backend (CLAUDE.md §2.2). core is the lower layer.'
            },
            {
              group: ['@/*', '@components/*'],
              message:
                'core must not depend on app (CLAUDE.md §2.2). core is Node-side adapter logic.'
            }
          ]
        }
      ]
    }
  }
]
