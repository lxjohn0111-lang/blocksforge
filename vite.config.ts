import { defineConfig, type Plugin } from 'vite';

/**
 * Game portals can run the build in a sandboxed iframe (an opaque "null" origin) and serve it from a
 * static host without CORS headers. Module scripts and `crossorigin` stylesheets are fetched in CORS
 * mode, so there they are blocked and the page stays blank: ship one classic, deferred script and a
 * plain stylesheet link instead.
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

/**
 * Every browser that runs the game reads woff2, so drop the woff fallbacks from the font stylesheets
 * instead of shipping them as files nobody requests.
 */
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource\/.*\.css(\?|$)/.test(id)) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScript(), woff2Only()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
    modulePreload: false,
    // every file next to index.html: a portal's upload unpacked the zip's assets/ folder wrongly, so its
    // files answered with errors while the files at the root loaded
    assetsDir: '',
    // one stylesheet file: a style element injected by the script would be refused under a strict CSP
    cssCodeSplit: false,
    // fonts are always fetched in CORS mode too: inline them
    assetsInlineLimit: (file) => file.endsWith('.woff2'),
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
  server: { host: true },
});
