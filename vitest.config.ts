import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the web app (server tests keep using node --test).
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  // Mesmo dedupe do vite.config.ts: os pacotes do C3Theme linkados têm o próprio React/Router no monorepo.
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react-router',
      'react-intl',
      '@mui/material',
      '@emotion/react',
      '@emotion/styled',
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
    // O `dist` do @c3theme/ui importa sem extensão (ex.: `./theme/vars`). Com pnpm o pacote cai em
    // `node_modules/.pnpm` e o Vitest o externaliza; aí o Node ESM não resolve. Inlinar deixa o Vite resolver
    // como faz no build. (Pedido ao C3Theme: emitir `.js` nos imports para funcionar em Node ESM puro.)
    server: { deps: { inline: [/@c3theme\//] } },
    // Long user-event flows (automation rules, filters) exceed 5s on a loaded machine.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/agent/**/*.{ts,tsx}'],
      // O spike do C3Theme é dev-only (`?c3spike`) e monta MUI fora do ambiente de teste do app.
      exclude: ['src/agent/main.tsx', 'src/agent/types.ts', 'src/agent/Entry.tsx', 'src/agent/c3/**'],
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: 'test-results/coverage-ui',
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
