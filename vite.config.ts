import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // base relativa: funciona em localhost, GitHub Pages (/crm-sof/) e Azure
  base: './',
  plugins: [preact()],
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  // lista de arquivos do build, lida pelo service worker para funcionar offline
  build: { manifest: 'asset-manifest.json' },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node' },
});
