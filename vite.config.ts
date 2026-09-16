import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  base: process.env.PAGES_BASE || '/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
