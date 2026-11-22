import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from "vite-plugin-wasm";
import path from 'node:path';

// SM64_BINDS_FRONTEND=<path to sm64-binds/javascript> uses a local checkout of
// sm64-binds-frontend (and so its game build) instead of the npm package.
const localBinds = process.env.SM64_BINDS_FRONTEND && path.resolve(process.env.SM64_BINDS_FRONTEND);

// https://vite.dev/config/
export default defineConfig({
  assetsInclude: ['**/*.xor'],
  plugins: [
    react(),
    wasm(),
  ],
  // The package's subpaths (the replay player) need their own aliases; React must be
  // one copy even when the checkout has its own node_modules.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: localBinds ? [
      { find: 'sm64-binds-frontend/replay.css', replacement: path.join(localBinds, 'src/replay/replay.css') },
      { find: 'sm64-binds-frontend/replay', replacement: path.join(localBinds, 'src/replay/index.js') },
      { find: /^sm64-binds-frontend$/, replacement: localBinds },
    ] : [],
  },
  server: {
    ...(localBinds ? { fs: { allow: ['..', localBinds] } } : {}),
    // The Objective-RRT tree server (objective-rrt/tools/viz.py) for the tree view,
    // and the objective-scattershot data server (objective-scattershot/tools/serve.py).
    proxy: {
      '/obrrt': { target: 'http://localhost:8090', rewrite: (p) => p.replace(/^\/obrrt/, '') },
      '/oss': { target: 'http://localhost:8091', rewrite: (p) => p.replace(/^\/oss/, '') },
    },
  },
  base: '/sm64-viewer',
})
