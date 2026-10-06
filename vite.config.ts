import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
import react from '@vitejs/plugin-react';
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  // Relative asset URLs let the same build run inside Tauri and under /app/ on the public listener.
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', agent: 'agent.html' } } },
  server: {
    port: 1420,
    strictPort: true,
    // Agent UI in development: http://127.0.0.1:1420/agent.html talks to the public listener.
    proxy: { '/api/v1': 'http://127.0.0.1:17382' },
  },
  clearScreen: false,
});
