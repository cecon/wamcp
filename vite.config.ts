import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  // One app for everyone: the backend serves this build at /app/ to the Tauri window and to browsers
  // on the network, so asset URLs stay relative.
  base: './',
  build: { rollupOptions: { input: { main: 'index.html' } } },
  server: {
    port: 1420,
    strictPort: true,
    // In development (and in `tauri dev`) http://127.0.0.1:1420/ talks to the backend listener.
    // Keep the browser's Host: the API only accepts same-origin requests (the string shorthand
    // would set changeOrigin and make every login fail with "Origem não permitida").
    proxy: {
      '/api/v1': { target: 'http://127.0.0.1:17382', changeOrigin: false },
      '/api/helpdesk': { target: 'http://127.0.0.1:17382', changeOrigin: false },
    },
  },
  clearScreen: false,
});
