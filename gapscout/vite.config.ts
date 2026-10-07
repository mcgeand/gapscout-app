import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Read rather than imported so no tsconfig needs `resolveJsonModule` and the
// dependency lists never reach the client bundle. Mirrored in vitest.config.ts.
const APP_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
).version

// Vendor packages that get their own chunk, keyed by package name.
const VENDOR_CHUNKS: Record<string, string> = {
  // React core
  react: 'vendor-react',
  'react-dom': 'vendor-react',
  'react-router': 'vendor-react',
  'react-router-dom': 'vendor-react',
  scheduler: 'vendor-react',

  // React Flow (large dependency)
  reactflow: 'vendor-reactflow',

  // ELK layout engine
  elkjs: 'vendor-elk',

  // State management
  zustand: 'vendor-zustand',

  // Validation
  zod: 'vendor-zod',

  // UI utilities
  'react-hot-toast': 'vendor-ui',
  'lucide-react': 'vendor-ui',

  // Data utilities
  nanoid: 'vendor-data',
  papaparse: 'vendor-data',
}

/**
 * Package a module id belongs to, or null for first-party source.
 *
 * Reads the last `node_modules/` segment so pnpm's nested store layout
 * (`node_modules/.pnpm/react@19.2.8/node_modules/react/index.js`) resolves to
 * `react` rather than `.pnpm`.
 */
function packageOf(id: string): string | null {
  const segments = id.split('node_modules/')
  if (segments.length < 2) return null

  const parts = segments[segments.length - 1].split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Stamped into the Markdown export footer (PRD 4.12.1) so the generated
  // document reports the build it came from rather than a literal that drifts.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  // Path aliases for cleaner imports
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@pages': resolve(__dirname, './src/pages'),
      '@state': resolve(__dirname, './src/state'),
      '@services': resolve(__dirname, './src/services'),
      '@data': resolve(__dirname, './src/data'),
      '@lib': resolve(__dirname, './src/lib'),
      '@app': resolve(__dirname, './src/app'),
    },
  },

  // Build optimization
  build: {
    // Enable sourcemaps for debugging
    sourcemap: true,

    // Rollup options for code splitting
    rollupOptions: {
      output: {
        // Manual chunks for better caching.
        //
        // This must be the function form: Vite 8 bundles with Rolldown, whose
        // `manualChunks` only accepts a function. The function is called per
        // module rather than per entry, so packages the object form used to
        // pull in transitively (react-router under react-router-dom,
        // @reactflow/* under reactflow) have to be named here explicitly.
        manualChunks(id) {
          const pkg = packageOf(id)
          if (!pkg) return undefined
          if (pkg.startsWith('@reactflow/')) return 'vendor-reactflow'
          return VENDOR_CHUNKS[pkg]
        },
      },
    },

    // Increase chunk size warning limit (React Flow is large)
    chunkSizeWarningLimit: 600,
  },

  // Optimize dev server
  server: {
    // Enable HMR
    hmr: true,
  },

  // Optimize deps
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'reactflow', 'zustand', 'zod', 'nanoid'],
  },
})
