module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    // Removed project reference to avoid tsconfig conflicts
  },
  rules: {
    
    // TypeScript-specific rules
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true 
    }],
    '@typescript-eslint/no-explicit-any': 'off', // Turn off for generated API code
  },
  ignorePatterns: [
    'dist/', 
    'node_modules/', 
    '*.js',
    'src/api/**/*',        // Ignore generated API code
    'src/model/**/*',      // Ignore generated model code
    'src/__tests__/**/*'   // Ignore test files
  ],
};