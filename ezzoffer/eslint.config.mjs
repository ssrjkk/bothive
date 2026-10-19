import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Пакет деплоя содержит плоскую копию проекта (standalone-раскладка).
    // Без этого линтер проверяет её второй раз и ругается на 555 ошибок,
    // которых в исходниках нет.
    'deploy-out/**',
    'pages-out/**',
  ]),
]);

export default eslintConfig;
