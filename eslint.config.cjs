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
        { argsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off'
    }
  },

  // TypeScript test files
  {
    files: ['**/*.test.ts'],
    rules: {
      'dot-notation': 'off'
    }
  }
]
