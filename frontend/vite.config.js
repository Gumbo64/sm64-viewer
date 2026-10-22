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
  resolve: localBinds ? { alias: { 'sm64-binds-frontend': localBinds } } : {},
  server: localBinds ? { fs: { allow: ['..', localBinds] } } : {},
  base: '/sm64-viewer',
})
