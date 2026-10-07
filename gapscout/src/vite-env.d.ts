/// <reference types="vite/client" />

/** App version from package.json, injected by `define` in vite/vitest config. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_FORCE_UPDATER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
