import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
import react from '@vitejs/plugin-react';
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
