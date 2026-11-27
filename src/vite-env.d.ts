/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Target OS, injected by the `define` in vite.config.ts. See
   * src/lib/platform.ts.
   */
  readonly TAURI_ENV_PLATFORM: "linux" | "darwin" | "windows";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
