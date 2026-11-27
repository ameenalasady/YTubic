import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const { env, platform: hostPlatform } = process;

const host = env.TAURI_DEV_HOST;

/**
 * Target OS, baked in at build time so the frontend never has to sniff
 * navigator.platform or a user agent. Tauri sets TAURI_ENV_PLATFORM to the
 * target triple's OS for beforeDevCommand / beforeBuildCommand, so a
 * cross-compiled bundle reports the target rather than the host. Fall back
 * to the host when Vite runs outside Tauri (pnpm dev, pnpm build, vitest).
 */
const platform =
  env.TAURI_ENV_PLATFORM ??
  (hostPlatform === "win32"
    ? "windows"
    : hostPlatform === "darwin"
      ? "darwin"
      : hostPlatform);

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // `define` is also the only way into index.html: Vite exposes every
  // `import.meta.env.*` define to the HTML pass as a `%NAME%` substitution,
  // and a classic inline <script> never goes through `define` itself. Off
  // in tests, which run in node with no Tauri env and expect the platform
  // flags to stay false (see src/lib/update-source.test.ts).
  define:
    mode === "test"
      ? {}
      : { "import.meta.env.TAURI_ENV_PLATFORM": JSON.stringify(platform) },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
