import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: 'desktop-build',
    emptyOutDir: false,
    lib: {
      entry: 'desktop/server.ts',
      formats: ['es'],
      fileName: () => 'server.mjs',
    },
    rollupOptions: { external: (id) => id.startsWith('node:') },
  },
});
