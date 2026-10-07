import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Tailwind only reaches the agent UI: its stylesheet is imported by src/agent/main.tsx alone.
  plugins: [react(), tailwindcss()],
  // Relative asset URLs let the same build run inside Tauri and under /app/ on the public listener.
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', agent: 'agent.html' } } },
  server: {
    port: 1420,
    strictPort: true,
    // Agent UI in development: http://127.0.0.1:1420/agent.html talks to the public listener.
    // Keep the browser's Host: the API only accepts same-origin requests (the string shorthand
    // would set changeOrigin and make every login fail with "Origem não permitida").
    proxy: { '/api/v1': { target: 'http://127.0.0.1:17382', changeOrigin: false } },
  },
  clearScreen: false,
});
