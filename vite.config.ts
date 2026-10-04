import { defineConfig } from 'vite';

// `/laya` -> serveur Laya local (`npm run laya`), facultatif : sans lui, l'application garde ses moteurs locaux
export default defineConfig({
  server: {
    proxy: {
      '/laya': { target: 'http://127.0.0.1:8765', rewrite: (p) => p.replace(/^\/laya/, '') },
    },
  },
});
