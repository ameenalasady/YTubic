import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { IS_LINUX } from "@/lib/platform";

/** The single query next-themes resolves `"system"` from. */
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** Must match `EVENT` in `src-tauri/src/system_theme.rs`. */
const SYSTEM_THEME_EVENT = "system-theme";

type ColorScheme = "dark" | "light" | "no-preference";

type QueryListener = (event: MediaQueryListEvent) => void;

declare global {
  interface Window {
    /**
     * Injected at document start by `src-tauri/src/system_theme.rs`, before
     * `index.html`'s pre-paint script reads it. Absent means the portal had
     * not answered when the window was built.
     */
    __ytubicColorScheme?: ColorScheme;
  }
}

/** Last portal value, or `null` while the webview's own query decides. */
let portalScheme: ColorScheme | null = null;
let nativeQuery: MediaQueryList | null = null;
let installed = false;

function isScheme(value: unknown): value is ColorScheme {
  return value === "dark" || value === "light" || value === "no-preference";
}

function currentMatches(): boolean {
  if (portalScheme !== null) return portalScheme === "dark";
  return nativeQuery?.matches ?? false;
}

/**
 * Stand-in for the one MediaQueryList next-themes reads. `matches` prefers
 * the portal value, and listeners fire when either the portal or the engine
 * changes so next-themes re-applies the theme class.
 */
class PortalColorSchemeQuery {
  readonly media = COLOR_SCHEME_QUERY;
  onchange: QueryListener | null = null;

  private readonly listeners = new Set<QueryListener>();
  private readonly legacyListeners = new Set<QueryListener>();

  constructor(native: MediaQueryList) {
    native.addEventListener("change", () => {
      if (portalScheme === null) this.notify();
    });
  }

  get matches(): boolean {
    return currentMatches();
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) {
    if (type === "change" && typeof listener === "function") {
      this.listeners.add(listener as QueryListener);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) {
    if (type === "change" && typeof listener === "function") {
      this.listeners.delete(listener as QueryListener);
    }
  }

  // next-themes 0.4.6 still uses the legacy MediaQueryList API.
  addListener(listener: QueryListener) {
    this.legacyListeners.add(listener);
  }

  removeListener(listener: QueryListener) {
    this.legacyListeners.delete(listener);
  }

  dispatchEvent(): boolean {
    this.notify();
    return true;
  }

  notify() {
    const event = {
      matches: this.matches,
      media: this.media,
    } as MediaQueryListEvent;
    this.onchange?.(event);
    for (const listener of this.listeners) listener(event);
    for (const listener of this.legacyListeners) listener(event);
  }
}

/**
 * Feed the XDG portal's color-scheme preference to next-themes on Linux.
 *
 * WebKitGTK (GTK3) answers `prefers-color-scheme` from GTK's own theme and
 * never reads `org.freedesktop.appearance color-scheme`, so desktops that
 * announce dark mode only through the portal resolve "System" as light.
 * `src-tauri/src/system_theme.rs` reads the portal before the window exists
 * and injects the value at document start; live changes arrive as an event.
 * This override makes `window.matchMedia` report either. No-op off Linux,
 * where the engine query is already correct.
 */
export function installSystemThemeBridge() {
  if (!IS_LINUX || installed || typeof window === "undefined") return;
  installed = true;

  nativeQuery = window.matchMedia(COLOR_SCHEME_QUERY);
  const native = window.matchMedia.bind(window);

  const query = new PortalColorSchemeQuery(nativeQuery);
  window.matchMedia = (input: string) =>
    input === COLOR_SCHEME_QUERY
      ? (query as unknown as MediaQueryList)
      : native(input);

  const update = (scheme: ColorScheme) => {
    portalScheme = scheme === "no-preference" ? null : scheme;
    query.notify();
  };

  // The window was built after the portal answered (`system_theme::start`),
  // so this matches the value the pre-paint script in index.html used. An
  // injected "no-preference" means the portal answered and declined, which
  // leaves the webview's query in charge.
  const injected = window.__ytubicColorScheme;
  if (isScheme(injected)) update(injected);

  let live = false;
  void listen<string>(SYSTEM_THEME_EVENT, (event) => {
    if (isScheme(event.payload)) {
      live = true;
      update(event.payload);
    }
  }).catch(() => {});

  // The init script is a constant replayed on every load, so after a reload
  // it can be older than the desktop's current theme, and skipping the stale
  // check would pin that value until the next portal signal. Ask once per
  // load instead: the command answers from the watcher's live value, so the
  // common case costs one IPC and no D-Bus round trip. A live change that
  // lands first makes the reply stale, hence `live`.
  void invoke<unknown>("system_color_scheme")
    .then((scheme) => {
      if (live) return;
      if (isScheme(scheme)) update(scheme);
      else if (scheme === null) update("no-preference");
    })
    .catch(() => {});
}
