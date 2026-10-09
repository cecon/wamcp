import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the web app (server tests keep using node --test).
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
    // Long user-event flows (automation rules, filters) exceed 5s on a loaded machine.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/agent/**/*.{ts,tsx}'],
      exclude: ['src/agent/main.tsx', 'src/agent/types.ts'],
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: 'test-results/coverage-ui',
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
