import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'distribution-licenses',
    generateBundle() {
      for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(new URL('../../' + file, import.meta.url), 'utf8') });
      }
    },
  }],
  build: {
    rollupOptions: {
      input: { index: 'index.html', capture: 'src/capture.ts' },
      output: { entryFileNames: asset => asset.name === 'capture' ? 'capture.js' : 'assets/[name]-[hash].js' },
    },
  },
});
