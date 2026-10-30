import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/main.tsx',
    },
  },
  html: {
    template: './index.html',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // Бэкенд пишет загрузки в uploads/ — без этого rsbuild watcher уходит в
  // бесконечный rebuild-thrash и расшатывает HMR/dev-server. Игнорируем data-каталоги.
  tools: {
    rspack: {
      watchOptions: {
        ignored: ['**/node_modules/**', '**/uploads/**'],
      },
    },
  },
});
