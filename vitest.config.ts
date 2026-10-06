import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the agent web UI (server tests keep using node --test).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/agent/**/*.{ts,tsx}', 'src/components/HelpdeskSetup.tsx'],
      exclude: ['src/agent/main.tsx', 'src/agent/types.ts'],
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: 'test-results/coverage-ui',
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
