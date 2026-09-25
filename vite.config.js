import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false, hmr: process.env.NO_HMR ? false : true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
