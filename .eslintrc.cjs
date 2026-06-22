module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  ignorePatterns: [
    '.angular/',
    '.codex*/',
    'coverage/',
    'dist/',
    'node_modules/',
    'outputs/',
    '*.zip'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  overrides: [
    {
      files: ['*.js', '*.cjs', '*.mjs'],
      extends: ['eslint:recommended'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
      }
    },
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
      }
    }
  ]
};
