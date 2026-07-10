// Discord Rich Presence: broadcasts the current track to the user's Discord
// profile over Discord's local IPC socket, via the `discord-rich-presence`
// crate.
//
// Unlike the OS media controls in `media.rs`, this IPC client is a plain
// `UnixStream`/`File` under the hood — it's `Send`, so it lives behind a
// regular `std::sync::Mutex` in managed state rather than a main-thread-only
// thread-local.
//
// Everything about *what* is shown — which fields are shared, the "Listening
// to" / "Playing" / "Watching" verb, whether timestamps show, whether music
// videos are filtered out — is decided by the frontend (the settings in
// `src/lib/store/discord.ts`, applied in the push effect in
// `src/lib/audio-engine.ts`). This module is a thin, dumb sink: it takes
// whatever non-empty fields it's handed and assembles a Discord `Activity`,
// and its only real job is connection lifecycle + respecting Discord's rate
// limit (roughly 5 updates per 15s) via a dedup signature — the frontend
// pushes on the same ~2s cadence it uses for the OS media controls.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{
    Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;

#[derive(Default)]
pub struct DiscordState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    client: Option<DiscordIpcClient>,
    connected: bool,
    application_id: String,
    enabled: bool,
    /// Signature of the last activity actually sent, so the frontend's
    /// periodic refresh doesn't re-send an unchanged payload into Discord's
    /// rate limit.
    last_sig: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn disconnect(inner: &mut Inner) {
    if let Some(client) = inner.client.as_mut() {
        let _ = client.close();
    }
    inner.client = None;
    inner.connected = false;
    inner.last_sig = None;
}

/// Try to connect a fresh client for `application_id`. Failure (Discord not
/// running, no IPC socket yet) is left for the caller to treat as non-fatal —
/// `inner.client` simply stays `None` and a later `discord_update` retries.
fn connect(inner: &mut Inner, application_id: &str) {
    let mut client = DiscordIpcClient::new(application_id);
    match client.connect() {
        Ok(()) => {
            inner.connected = true;
            inner.client = Some(client);
        }
        Err(e) => {
            eprintln!("[discord] connect failed: {e}");
            inner.connected = false;
            inner.client = None;
        }
    }
}

/// Payload for `discord_update`. The frontend has already applied every
/// content toggle (show title / show art / only-songs filter / etc.) before
/// calling this — an empty string means "omit this element", not "use a
/// default".
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    /// The "<NAME>" in "<verb> NAME" — overrides the app's registered name.
    /// Empty ⇒ Discord falls back to the application's own name.
    name: String,
    /// "listening" | "playing" | "watching" — the header verb.
    activity_type: String,
    /// Track title → Discord "details" line.
    details: String,
    /// Artist → Discord "state" line.
    state: String,
    large_image: String,
    large_text: String,
    button_label: String,
    button_url: String,
    /// Whether to show the elapsed/total progress bar at all.
    timestamps: bool,
    duration: f64,
    elapsed: f64,
    paused: bool,
}

// ── Tauri commands (called from the frontend) ──

/// Apply the connection half of the Integrations-tab settings: enable/disable
/// and which Discord application (Client ID) to present as. Reconnects when
/// the Client ID changes, disconnects when disabled or the ID is cleared.
#[tauri::command]
pub fn discord_set_config(
    state: tauri::State<'_, DiscordState>,
    enabled: bool,
    application_id: String,
) {
    let mut inner = state.0.lock().unwrap();
    inner.enabled = enabled;

    if !enabled || application_id.is_empty() {
        disconnect(&mut inner);
        inner.application_id = application_id;
        return;
    }

    if inner.application_id == application_id && inner.client.is_some() {
        return; // unchanged — nothing to do
    }

    disconnect(&mut inner);
    inner.application_id = application_id.clone();
    connect(&mut inner, &application_id);
}

/// Push the currently-playing track's presence, as already shaped by the
/// frontend's content/filter settings. No-op if disabled; lazily reconnects
/// if Discord wasn't running on a previous attempt.
#[tauri::command]
pub fn discord_update(state: tauri::State<'_, DiscordState>, payload: PresencePayload) {
    let mut inner = state.0.lock().unwrap();
    if !inner.enabled {
        return;
    }

    if inner.client.is_none() {
        if inner.application_id.is_empty() {
            return;
        }
        let app_id = inner.application_id.clone();
        connect(&mut inner, &app_id);
        if inner.client.is_none() {
            return; // still not running — try again next push
        }
    }

    // Timestamps only while actually playing with a known duration —
    // otherwise Discord would show a bar ticking on a paused track.
    let start_ms = if payload.timestamps && !payload.paused && payload.duration > 0.0 {
        Some(now_ms() - (payload.elapsed.max(0.0) * 1000.0) as i64)
    } else {
        None
    };
    // Bucket the start time to ~2s so the periodic refresh (same value,
    // recomputed from a slightly later `elapsed`) collapses to the same
    // signature, while an actual seek or pause/resume (which shifts the
    // implied start by more than the bucket width) still triggers a push.
    let start_bucket = start_ms.map(|s| s / 2000);

    let sig = format!(
        "{}\u{1}{}\u{1}{}\u{1}{}\u{1}{}\u{1}{}\u{1}{}\u{1}{}\u{1}{:?}",
        payload.name,
        payload.activity_type,
        payload.details,
        payload.state,
        payload.large_image,
        payload.large_text,
        payload.button_label,
        payload.paused,
        start_bucket,
    );
    if inner.last_sig.as_deref() == Some(sig.as_str()) {
        return;
    }

    let activity_type = match payload.activity_type.as_str() {
        "playing" => ActivityType::Playing,
        "watching" => ActivityType::Watching,
        _ => ActivityType::Listening,
    };

    let mut activity = Activity::new().activity_type(activity_type);
    if !payload.name.is_empty() {
        activity = activity.name(&payload.name);
    }
    if !payload.details.is_empty() {
        // `details` is what we point `status_display_type` at, so it's also
        // what shows in the member-list one-liner *before* a viewer expands
        // the card — Discord's default there is just the app's name, so
        // without this override every listen shows "Listening to <app
        // name>" until clicked. The frontend folds artist + title into this
        // field for exactly that reason (see audio-engine.ts).
        activity = activity
            .details(&payload.details)
            .status_display_type(StatusDisplayType::Details);
    }
    if !payload.state.is_empty() {
        activity = activity.state(&payload.state);
    }
    if !payload.large_image.is_empty() {
        let mut assets = Assets::new().large_image(&payload.large_image);
        if !payload.large_text.is_empty() {
            assets = assets.large_text(&payload.large_text);
        }
        activity = activity.assets(assets);
    }
    if let Some(start) = start_ms {
        let remaining = (payload.duration - payload.elapsed.max(0.0)).max(0.0);
        let end = start + (remaining * 1000.0) as i64;
        activity = activity.timestamps(Timestamps::new().start(start).end(end));
    }
    if !payload.button_label.is_empty() && !payload.button_url.is_empty() {
        activity = activity.buttons(vec![Button::new(
            &payload.button_label,
            &payload.button_url,
        )]);
    }

    let result = inner.client.as_mut().unwrap().set_activity(activity);
    match result {
        Ok(()) => {
            inner.connected = true;
            inner.last_sig = Some(sig);
        }
        Err(e) => {
            eprintln!("[discord] set_activity failed: {e}");
            // Drop the client — the socket may have gone stale (Discord
            // restarted); the next update reconnects from scratch.
            inner.connected = false;
            inner.client = None;
        }
    }
}

/// Clear the presence (queue emptied, track filtered out, paused with
/// "hide while paused" on, etc.) without dropping the connection.
#[tauri::command]
pub fn discord_clear(state: tauri::State<'_, DiscordState>) {
    let mut inner = state.0.lock().unwrap();
    if let Some(client) = inner.client.as_mut() {
        let _ = client.clear_activity();
    }
    inner.last_sig = None;
}
