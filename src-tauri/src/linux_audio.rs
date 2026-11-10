//! Startup-only workarounds for WebKitGTK audio on Linux.
//!
//! Both are environment variables that WebKit's web process inherits when it
//! is spawned, so `configure` must run before Tauri/GTK initialization.

use std::path::{Path, PathBuf};

/// Built from `gst-plugin/ytubicsink.c` by build.rs.
const PLUGIN_FILE: &str = "libgstytubicsink.so";
/// Where the deb/rpm/AppImage bundles install it, relative to the binary's
/// directory (`/usr/bin`, or `$APPDIR/usr/bin`). See tauri.linux.conf.json.
const INSTALLED_PLUGIN_DIR: &str = "../lib/ytubic/gstreamer-1.0";

pub fn configure() {
    match plugin_dir() {
        Some(dir) => add_plugin_dir(&dir),
        None => eprintln!(
            "[linux-audio] {PLUGIN_FILE} not found; the equaliser may be silent on \
             Bluetooth outputs"
        ),
    }
    skip_stream_restore();
}

fn plugin_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(bin) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        candidates.push(bin.join(INSTALLED_PLUGIN_DIR));
    }
    // `cargo build` / `tauri dev`: the copy build.rs just compiled.
    #[cfg(debug_assertions)]
    if let Some(dir) = option_env!("YTUBIC_GST_PLUGIN_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    candidates
        .into_iter()
        .find(|dir| dir.join(PLUGIN_FILE).is_file())
        .map(|dir| dir.canonicalize().unwrap_or(dir))
}

/// Put the bundled plugin on GStreamer's search path. It registers a
/// pulsesink subclass ranked just above pulsesink, which gives WebAudio
/// streams a larger buffer: with the stock 200 ms one, WebKit's AudioContext
/// output is pure silence on sinks reporting ~200 ms of latency, which is
/// what Bluetooth headphones do (see the comment in the plugin's source).
fn add_plugin_dir(dir: &Path) {
    // GStreamer reads the versioned variable instead when it is set.
    let var = if std::env::var_os("GST_PLUGIN_PATH_1_0").is_some() {
        "GST_PLUGIN_PATH_1_0"
    } else {
        "GST_PLUGIN_PATH"
    };
    let mut paths = vec![dir.to_path_buf()];
    if let Some(existing) = std::env::var_os(var) {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var(var, joined);
    }
}

/// Ask WirePlumber not to restore or save volume and mute for this app's
/// streams. WebKit writes an <audio> element's volume and mute to its
/// stream, WirePlumber stores the last values per app and applies them to
/// every new stream, including the AudioContext's, which the page has no
/// way to reach. A player muted when the equaliser was switched on would
/// then stay silent. The app keeps its own volume, so nothing is lost.
fn skip_stream_restore() {
    const PROP: &str = "state.restore-props=false";
    let value = match std::env::var("PULSE_PROP") {
        Ok(existing) if existing.contains("state.restore-props") => return,
        Ok(existing) if !existing.trim().is_empty() => format!("{existing} {PROP}"),
        _ => PROP.to_owned(),
    };
    std::env::set_var("PULSE_PROP", value);
}
