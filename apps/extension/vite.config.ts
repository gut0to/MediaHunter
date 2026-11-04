import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { index: 'index.html', capture: 'src/capture.ts' },
      output: { entryFileNames: asset => asset.name === 'capture' ? 'capture.js' : 'assets/[name]-[hash].js' },
    },
  },
});
