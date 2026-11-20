//! Linux bridge for the desktop's color-scheme preference.
//!
//! WebKitGTK derives `prefers-color-scheme` from GTK's theme settings, not
//! from the XDG desktop portal, so a desktop that advertises dark mode only
//! through `org.freedesktop.appearance color-scheme` (KDE, or GNOME with a
//! light-named GTK theme) resolves "System" as light. Read the portal value
//! here and forward it to both windows; `src/lib/system-theme.ts` overrides
//! next-themes' media query with it. See that file for the JS side.
//!
//! Linux-only: Windows and macOS webviews already map the OS theme onto
//! `prefers-color-scheme`.

use tauri::{AppHandle, Emitter};
use zbus::blocking::Connection;
use zbus::zvariant::OwnedValue;

/// Tauri event consumed by `src/lib/system-theme.ts`. The payload is
/// `"dark"`, `"light"`, or `"no-preference"`.
pub const EVENT: &str = "system-theme";

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";

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

/// Read the portal preference once. Used by the `system_color_scheme`
/// command because the setup-time emit can land before a webview has
/// installed its listener. `None` means the portal could not be reached.
pub fn read() -> Option<&'static str> {
    let connection = Connection::session().ok()?;
    let proxy = SettingsProxyBlocking::new(&connection).ok()?;
    let value = proxy.read_one(NAMESPACE, KEY).ok()?;
    Some(ColorScheme::from_portal_value(&value).as_str())
}

/// Start watching the portal for the lifetime of the app.
pub fn init(app: &AppHandle) {
    let app = app.clone();
    // zbus's blocking API parks the calling thread, so keep it off both
    // the async runtime and the main thread.
    let _ = std::thread::Builder::new()
        .name("system-theme".into())
        .spawn(move || watch(&app));
}

fn watch(app: &AppHandle) {
    let connection = match Connection::session() {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("[system-theme] session bus unavailable: {error}");
            emit(app, ColorScheme::NoPreference);
            return;
        }
    };
    let proxy = match SettingsProxyBlocking::new(&connection) {
        Ok(proxy) => proxy,
        Err(error) => {
            eprintln!("[system-theme] settings portal unavailable: {error}");
            emit(app, ColorScheme::NoPreference);
            return;
        }
    };
    match proxy.read_one(NAMESPACE, KEY) {
        Ok(value) => emit(app, ColorScheme::from_portal_value(&value)),
        Err(error) => {
            eprintln!("[system-theme] color-scheme read failed: {error}");
            emit(app, ColorScheme::NoPreference);
            return;
        }
    }
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
            emit(app, ColorScheme::from_portal_value(args.value()));
        }
    }
}

fn emit(app: &AppHandle, scheme: ColorScheme) {
    if let Err(error) = app.emit(EVENT, scheme.as_str()) {
        eprintln!("[system-theme] emit failed: {error}");
    }
}
