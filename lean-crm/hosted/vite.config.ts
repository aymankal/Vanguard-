// Builds the claude.ai-hosted Lean CRM: the React app plus the server code, compiled for the browser.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const shim = (f: string) => path.join(here, 'shims', f);

/** Server modules that need Node (API key, SMTP, sessions) are swapped for hosted versions. */
const SWAP = ['config', 'errors', 'auth', 'ai', 'mail'];
const swapServerModules = (): Plugin => ({
  name: 'lean-crm-hosted-swap',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !importer.includes(`${path.sep}server${path.sep}`)) return null;
    const m = /^\.\/(\w+)\.js$/.exec(source);
    if (m && SWAP.includes(m[1])) return path.join(here, `${m[1]}.ts`);
    return null;
  },
});

export default defineConfig({
  root,
  plugins: [swapServerModules(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^better-sqlite3$/, replacement: shim('better-sqlite3.ts') },
      { find: /^express$/, replacement: shim('express.ts') },
      { find: /^(node:)?(fs|path|os)$/, replacement: shim('node.ts') },
      { find: /^dotenv\/config$/, replacement: shim('node.ts') },
      { find: /^pdfkit$/, replacement: shim('pdfkit.ts') },
    ],
  },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '({})' },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    lib: { entry: path.join(here, 'main.tsx'), formats: ['es'], fileName: () => 'app.js', cssFileName: 'app' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
