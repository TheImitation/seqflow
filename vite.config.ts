import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const PROXY_PORT = process.env.SEQFLOW_PROXY_PORT ?? '8787'

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],

  // GitHub Pages serves the app from /<repo>/, not from the domain root, so a
  // production build needs that prefix baked in. `vite preview` serves that
  // same build, so it needs the prefix too — without it the HTML asks for
  // /seqflow/assets/* and gets the SPA fallback, i.e. a blank page. Dev stays
  // at '/', where a base only makes localhost URLs longer. Self-hosting at the
  // root of your own domain: build with SEQFLOW_BASE=/.
  base: command === 'build' || isPreview ? (process.env.SEQFLOW_BASE ?? '/seqflow/') : '/',

  server: {
    // The AI proxy runs as a separate local process (`npm run dev:proxy`) so the
    // Anthropic key never reaches the browser bundle. Routing through the dev
    // server also means no CORS in the app's own code.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${PROXY_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    // Both diagram renderers and dagre are on the critical path; the default
    // 500 kB warning is noise here.
    chunkSizeWarningLimit: 900,
  },
}))
