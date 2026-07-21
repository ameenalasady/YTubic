/**
 * Small synchronous platform flags for layout-only decisions.
 *
 * WKWebView identifies itself as a Mac in both `navigator.platform` and its
 * user agent. Keeping this local avoids an async native round-trip during the
 * title bar's first paint. Backend behavior still uses Rust `cfg` gates.
 */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  (/Mac/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent));

export const IS_LINUX =
  typeof navigator !== "undefined" &&
  /Linux/i.test(navigator.platform) &&
  !/Android/i.test(navigator.userAgent);

/**
 * Linux and macOS builds ship as public betas: they are compiled and
 * unit-tested in CI but have no dedicated QA before release. Drives the
 * "Beta" chips in the sidebar and About dialog so users on those
 * platforms know reports are welcome (⋯ menu → Report an issue).
 */
export const IS_BETA_PLATFORM = IS_MAC || IS_LINUX;
