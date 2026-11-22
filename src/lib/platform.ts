/**
 * Small synchronous platform flags for layout-only decisions.
 *
 * Baked in at build time from the target OS (see the `define` in
 * vite.config.ts), not sniffed from `navigator.platform` or the user agent:
 * those were wrong under cross-compilation and needed an Android special case
 * because Android also reports a Linux platform. Backend behavior still uses
 * Rust `cfg` gates.
 */
const PLATFORM = import.meta.env.TAURI_ENV_PLATFORM;

export const IS_MAC = PLATFORM === "darwin";

export const IS_LINUX = PLATFORM === "linux";

export const IS_WINDOWS = PLATFORM === "windows";

/**
 * Linux and macOS builds ship as public betas: they are compiled and
 * unit-tested in CI but have no dedicated QA before release. Drives the
 * "Beta" chips in the sidebar and About dialog so users on those
 * platforms know reports are welcome (⋯ menu → Report an issue).
 */
export const IS_BETA_PLATFORM = IS_MAC || IS_LINUX;
