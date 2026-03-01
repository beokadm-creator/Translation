import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src/App.tsx', 'src/App.js', 'src/main.tsx', 'src/main.js', 'src/components/**', 'src/pages/**', 'src/hooks/**', 'src/assets/**', 'src/index.css', 'src/vite-env.d.ts', 'src/config.ts', 'src/config.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow 'as any' for service account compatibility
    },
  },
)
