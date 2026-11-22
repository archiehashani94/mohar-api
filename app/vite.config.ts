import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// COOP/COEP enable SharedArrayBuffer → multithreaded bb.js proving in the browser.
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react(), tailwindcss(), nodePolyfills({ include: ['buffer', 'process', 'util', 'stream', 'events'] })],
  server: { headers: isolation, proxy: { '/api': 'http://127.0.0.1:8787', '/rpc': { target: RPC, changeOrigin: true, rewrite: () => new URL(RPC).pathname } } },
  preview: { headers: isolation, proxy: { '/api': 'http://127.0.0.1:8787', '/rpc': { target: RPC, changeOrigin: true, rewrite: () => new URL(RPC).pathname } } },
  optimizeDeps: {
    exclude: ['@aztec/bb.js', '@noir-lang/noirc_abi', '@noir-lang/acvm_js', '@noir-lang/noir_js'],
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  worker: { format: 'es' },
});
