//! Linux bridge for the desktop's color-scheme preference.
//!
//! WebKitGTK derives `prefers-color-scheme` from GTK's theme settings, not
//! from the XDG desktop portal, so a desktop that advertises dark mode only
//! through `org.freedesktop.appearance color-scheme` (KDE, or GNOME with a
//! light-named GTK theme) resolves "System" as light.
//!
//! The main window is created from `tauri.conf.json` with `"create": false`
//! (see `create_main_window` in `lib.rs`) precisely so `start` can read the
//! portal first and hand the answer to the webview as an init script. Wry
//! runs that at document start, before the pre-paint theme script in
//! `index.html`, so the first paint is already right and nothing has to be
//! cached for the next launch. Later windows (`open_player_window`) get the
//! same script with the value current at creation time.
//!
//! Live changes go out as the `system-theme` event; `src/lib/system-theme.ts`
//! turns either signal into the one media query next-themes consults.
//!
//! Linux-only: Windows and macOS webviews already map the OS theme onto
//! `prefers-color-scheme`.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use zbus::blocking::Connection;
use zbus::zvariant::OwnedValue;

/// Tauri event consumed by `src/lib/system-theme.ts`. The payload is
/// `"dark"`, `"light"`, or `"no-preference"`.
pub const EVENT: &str = "system-theme";

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";

/// How long `start` holds up the first window. A portal that has to be
/// D-Bus-activated answers in a few hundred milliseconds at worst, so this
/// covers the common cold start; a wedged one must not stall launch, and a
/// late answer still reaches the frontend through `system_color_scheme` or
/// the event.
const STARTUP_WAIT: Duration = Duration::from_millis(200);

/// Last known preference, mirrored for windows created after startup.
/// `UNKNOWN` means the portal has not answered yet.
static CURRENT: AtomicU8 = AtomicU8::new(UNKNOWN);

const UNKNOWN: u8 = 0;
const NO_PREFERENCE: u8 = 1;
const DARK: u8 = 2;
const LIGHT: u8 = 3;

/// Sets `window.__ytubicColorScheme` for `index.html`'s pre-paint script.
const INIT_DARK: &str = "window.__ytubicColorScheme = \"dark\";";
const INIT_LIGHT: &str = "window.__ytubicColorScheme = \"light\";";
const INIT_NO_PREFERENCE: &str = "window.__ytubicColorScheme = \"no-preference\";";

/// The `org.freedesktop.appearance` `color-scheme` preference.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColorScheme {
    NoPreference,
    PreferDark,
    PreferLight,
}

impl ColorScheme {
    /// Values defined by the portal's Settings interface.
    const PREFER_DARK: u32 = 1;
    const PREFER_LIGHT: u32 = 2;

    /// Parse the variant returned by `ReadOne` or carried by
    /// `SettingChanged`. The portal encodes 0 as no preference; anything
    /// unrecognized means the same.
    fn from_portal_value(value: &OwnedValue) -> Self {
        match value.downcast_ref::<u32>() {
            Ok(Self::PREFER_DARK) => Self::PreferDark,
            Ok(Self::PREFER_LIGHT) => Self::PreferLight,
            _ => Self::NoPreference,
        }
    }

    /// Wire value consumed by `src/lib/system-theme.ts`.
    const fn as_str(self) -> &'static str {
        match self {
            Self::NoPreference => "no-preference",
            Self::PreferDark => "dark",
            Self::PreferLight => "light",
        }
    }

    /// Encoding for `CURRENT`.
    const fn code(self) -> u8 {
        match self {
            Self::NoPreference => NO_PREFERENCE,
            Self::PreferDark => DARK,
            Self::PreferLight => LIGHT,
        }
    }
}

/// The slice of `org.freedesktop.portal.Settings` we need.
#[zbus::proxy(
    interface = "org.freedesktop.portal.Settings",
    default_service = "org.freedesktop.portal.Desktop",
    default_path = "/org/freedesktop/portal/desktop"
)]
trait Settings {
    fn read_one(&self, namespace: &str, key: &str) -> zbus::Result<OwnedValue>;

    #[zbus(signal)]
    fn setting_changed(
        &self,
        namespace: String,
        key: String,
        value: OwnedValue,
    ) -> zbus::Result<()>;
}

/// Color scheme known right now, or `None` while the portal is still
/// unknown. `"no-preference"` is reported rather than omitted so the
/// frontend can tell "the portal declined" from "no answer yet".
pub fn current() -> Option<&'static str> {
    match CURRENT.load(Ordering::Relaxed) {
        DARK => Some("dark"),
        LIGHT => Some("light"),
        NO_PREFERENCE => Some("no-preference"),
        _ => None,
    }
}

/// Init script for the color scheme known right now, or `None` while the
/// portal is still unknown (the webview's own query then decides). This
/// runs on every page load, so a reload re-injects the value baked into the
/// window: it is the pre-paint hint, not the live answer, which is why
/// `system_color_scheme` reports `current()` rather than a fresh read.
pub fn init_script() -> Option<&'static str> {
    match CURRENT.load(Ordering::Relaxed) {
        DARK => Some(INIT_DARK),
        LIGHT => Some(INIT_LIGHT),
        NO_PREFERENCE => Some(INIT_NO_PREFERENCE),
        _ => None,
    }
}

/// Read the portal preference once, on its own connection. The
/// `system_color_scheme` command only falls back to this while `current()`
/// is still unknown, i.e. when the bounded startup read gave up.
/// `None` means the portal could not be reached.
pub fn read() -> Option<&'static str> {
    let connection = Connection::session().ok()?;
    let proxy = SettingsProxyBlocking::new(&connection).ok()?;
    let value = proxy.read_one(NAMESPACE, KEY).ok()?;
    Some(ColorScheme::from_portal_value(&value).as_str())
}

/// Start watching the portal for the lifetime of the app, waiting up to
/// `STARTUP_WAIT` for the first answer. Call this before creating a window
/// and pass the result to `initialization_script`.
pub fn start(app: &AppHandle) -> Option<&'static str> {
    let app = app.clone();
    let (ready, answered) = mpsc::channel();
    // zbus's blocking API parks the calling thread, so keep it off both
    // the async runtime and the main thread.
    let spawned = std::thread::Builder::new()
        .name("system-theme".into())
        .spawn(move || watch(&app, ready))
        .is_ok();
    if !spawned {
        return None;
    }
    // The channel carries a rendezvous, not the value: `watch` stores it in
    // `CURRENT` first, so a timeout still leaves anything that arrives late
    // readable for the next window.
    let _ = answered.recv_timeout(STARTUP_WAIT);
    init_script()
}

fn watch(app: &AppHandle, answered: mpsc::Sender<()>) {
    let connection = match Connection::session() {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("[system-theme] session bus unavailable: {error}");
            let _ = answered.send(());
            return;
        }
    };
    let proxy = match SettingsProxyBlocking::new(&connection) {
        Ok(proxy) => proxy,
        Err(error) => {
            eprintln!("[system-theme] settings portal unavailable: {error}");
            let _ = answered.send(());
            return;
        }
    };
    match proxy.read_one(NAMESPACE, KEY) {
        Ok(value) => publish(app, ColorScheme::from_portal_value(&value)),
        Err(error) => eprintln!("[system-theme] color-scheme read failed: {error}"),
    }
    // The first answer is in, or the read failed: `start` can stop waiting.
    // Release it before the subscription below, which is another round trip.
    let _ = answered.send(());
    let signals = match proxy.receive_setting_changed() {
        Ok(signals) => signals,
        Err(error) => {
            eprintln!("[system-theme] color-scheme watch failed: {error}");
            return;
        }
    };
    for signal in signals {
        let Ok(args) = signal.args() else { continue };
        if args.namespace().as_str() == NAMESPACE && args.key().as_str() == KEY {
            publish(app, ColorScheme::from_portal_value(args.value()));
        }
    }
}

fn publish(app: &AppHandle, scheme: ColorScheme) {
    CURRENT.store(scheme.code(), Ordering::Relaxed);
    if let Err(error) = app.emit(EVENT, scheme.as_str()) {
        eprintln!("[system-theme] emit failed: {error}");
    }
}
