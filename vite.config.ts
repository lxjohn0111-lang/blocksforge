import { defineConfig, type Plugin } from 'vite';

/**
 * Game portals can run the build in a sandboxed iframe (an opaque "null" origin) and serve it from a
 * static host without CORS headers. Module scripts and `crossorigin` stylesheets are fetched in CORS
 * mode, so there they are blocked and the page stays blank: ship one classic, deferred script instead.
 */
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<script type="module" crossorigin/g, '<script defer').replace(/ crossorigin(?=[\s>])/g, ''),
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScript()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
    modulePreload: false,
    // fonts are always fetched in CORS mode too: inline the woff2 files (the woff fallbacks stay as
    // files, which current browsers never request)
    assetsInlineLimit: (file) => file.endsWith('.woff2'),
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
  server: { host: true },
});
