import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Same injection as vite.config.ts, so a test asserting the export footer sees
// the version the app would actually stamp.
const APP_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
).version

export default defineConfig({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  test: {
    // Use jsdom for DOM testing
    environment: 'jsdom',

    // Required, not a preference. `lib/diagramInk.ts` reads the design tokens out
    // of globals.css with `?raw`, because an <svg> in an html-to-image capture
    // cannot resolve `var()` and the values must not be restated in JS. Vitest
    // stubs every .css import to an empty string when this is off — including
    // `?raw` — so the token parse would silently yield nothing under test while
    // working in the app. Costs nothing measurable: 943 tests, same 23s.
    css: true,

    // Global test utilities
    globals: true,

    // Setup files (run before each test file)
    setupFiles: ['./src/__tests__/setup.ts'],

    // Include test files
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],

    // Exclude patterns
    exclude: ['node_modules', 'dist', 'src-tauri'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },

    // Timeout for async tests (ms)
    testTimeout: 10000,

    // Reporter
    reporters: ['verbose'],
  },

  // Path aliases (same as main config)
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
})
