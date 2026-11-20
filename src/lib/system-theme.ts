import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { IS_LINUX } from "@/lib/platform";

/** The single query next-themes resolves `"system"` from. */
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** Must match `EVENT` in `src-tauri/src/system_theme.rs`. */
const SYSTEM_THEME_EVENT = "system-theme";

/**
 * Last portal value, mirrored into localStorage so the pre-paint script in
 * `index.html` can use it before this module loads. Linux only.
 */
const CACHE_KEY = "ytm-system-color-scheme";

type ColorScheme = "dark" | "light" | "no-preference";

type QueryListener = (event: MediaQueryListEvent) => void;

let portalScheme: ColorScheme | null = null;
let nativeQuery: MediaQueryList | null = null;
let installed = false;

function isScheme(value: unknown): value is ColorScheme {
  return value === "dark" || value === "light" || value === "no-preference";
}

function readCache(): ColorScheme | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return isScheme(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCache(scheme: ColorScheme) {
  try {
    localStorage.setItem(CACHE_KEY, scheme);
  } catch {
    // Paint hint only; the live value still comes from the event.
  }
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
 * `src-tauri/src/system_theme.rs` reads the portal and emits the value;
 * this override makes `window.matchMedia` report it. No-op off Linux, where
 * the engine query is already correct.
 */
export function installSystemThemeBridge() {
  if (!IS_LINUX || installed || typeof window === "undefined") return;
  installed = true;

  nativeQuery = window.matchMedia(COLOR_SCHEME_QUERY);
  const native = window.matchMedia.bind(window);

  const cached = readCache();
  if (cached === "dark" || cached === "light") portalScheme = cached;

  const query = new PortalColorSchemeQuery(nativeQuery);
  window.matchMedia = (input: string) =>
    input === COLOR_SCHEME_QUERY
      ? (query as unknown as MediaQueryList)
      : native(input);

  const update = (scheme: ColorScheme) => {
    portalScheme = scheme === "no-preference" ? null : scheme;
    writeCache(scheme);
    query.notify();
  };

  let live = false;
  void listen<string>(SYSTEM_THEME_EVENT, (event) => {
    if (isScheme(event.payload)) {
      live = true;
      update(event.payload);
    }
  }).catch(() => {});

  // The setup-time emit can arrive before the listener exists, so ask for
  // the current value too. Ignore the reply if a live change beat it.
  void invoke<unknown>("system_color_scheme")
    .then((scheme) => {
      if (live) return;
      if (isScheme(scheme)) update(scheme);
      // `null` means the portal is missing, so stop trusting a cached
      // value from an earlier session.
      else if (scheme === null) update("no-preference");
    })
    .catch(() => {});
}
