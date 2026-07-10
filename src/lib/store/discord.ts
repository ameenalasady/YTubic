import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DiscordActivityType = "listening" | "playing" | "watching";

/**
 * YTubic's own Discord application, shipped so Rich Presence works with zero
 * setup — the same pattern every other app with Rich Presence uses (Spotify,
 * VS Code, Steam games): the *developer* registers one Discord app and bakes
 * its Client ID into the shipped binary, so end users never see a "create a
 * Discord app" step. A registered Client ID is unavoidable — Discord's local
 * RPC handshake is literally `{ v: 1, client_id: "…" }`, there's no anonymous
 * mode — this just absorbs that step upstream instead of pushing it onto
 * every user.
 *
 * Don't change this unless you're intentionally presenting as a different
 * Discord application (e.g. your own fork's) — Settings → Integrations
 * surfaces the same warning next to the field that overrides it.
 */
export const DEFAULT_APPLICATION_ID = "1524980488501071942";

type State = {
  // ── Connection ──
  /** Master switch. Off ⇒ nothing is sent and any existing presence is cleared. */
  enabled: boolean;
  /** Discord application (Client ID) to present as. Defaults to YTubic's own
   *  (see `DEFAULT_APPLICATION_ID`); users can swap in their own app's ID. */
  applicationId: string;
  /** The "<NAME>" in "<verb> NAME" — independent of whatever the Discord
   *  application is actually named in the Developer Portal. Sent via
   *  Discord's activity name-override field (see discord.rs). */
  presenceName: string;

  // ── Presence content — every field the user can choose to share ──
  /** The "<verb>" in "<verb> <name>". */
  activityType: DiscordActivityType;
  /** Track title → Discord's "details" line. */
  showTitle: boolean;
  /** Artist → Discord's "state" line. */
  showArtist: boolean;
  /** Album art as the large image. */
  showAlbumArt: boolean;
  /** Album name as the large image's hover text. */
  showAlbumName: boolean;
  /** Live elapsed/total progress bar. */
  showTimestamps: boolean;
  /** "Listen on YouTube Music" button linking to the track. */
  showButton: boolean;

  // ── Filters / privacy ──
  /** Hide presence for standalone music videos — only show real album songs. */
  onlySongs: boolean;
  /** Clear presence entirely while paused, instead of freezing the bar. */
  hideWhenPaused: boolean;

  setEnabled: (v: boolean) => void;
  setApplicationId: (v: string) => void;
  setPresenceName: (v: string) => void;
  setActivityType: (v: DiscordActivityType) => void;
  setShowTitle: (v: boolean) => void;
  setShowArtist: (v: boolean) => void;
  setShowAlbumArt: (v: boolean) => void;
  setShowAlbumName: (v: boolean) => void;
  setShowTimestamps: (v: boolean) => void;
  setShowButton: (v: boolean) => void;
  setOnlySongs: (v: boolean) => void;
  setHideWhenPaused: (v: boolean) => void;
};

/**
 * Discord Rich Presence preferences, editable from Settings → Integrations.
 * Every field shown on the Discord profile is an explicit opt-in here — the
 * push effect in `lib/audio-engine.ts` reads this store and only invokes
 * `discord_update` with the fields the user has enabled.
 *
 * Only the main window plays audio and runs the push effect (see
 * `audio-engine.ts`), and the Settings dialog only mounts there too, so —
 * unlike `settings.ts` — this store doesn't need the cross-window `storage`
 * rehydrate bridge.
 */
export const useDiscordStore = create<State>()(
  persist(
    (set) => ({
      enabled: false,
      applicationId: DEFAULT_APPLICATION_ID,
      presenceName: "YouTube Music",

      activityType: "listening",
      showTitle: true,
      showArtist: true,
      showAlbumArt: true,
      showAlbumName: true,
      showTimestamps: true,
      showButton: false,

      onlySongs: true,
      hideWhenPaused: true,

      setEnabled: (enabled) => set({ enabled }),
      setApplicationId: (applicationId) => set({ applicationId: applicationId.trim() }),
      setPresenceName: (presenceName) => set({ presenceName }),
      setActivityType: (activityType) => set({ activityType }),
      setShowTitle: (showTitle) => set({ showTitle }),
      setShowArtist: (showArtist) => set({ showArtist }),
      setShowAlbumArt: (showAlbumArt) => set({ showAlbumArt }),
      setShowAlbumName: (showAlbumName) => set({ showAlbumName }),
      setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
      setShowButton: (showButton) => set({ showButton }),
      setOnlySongs: (onlySongs) => set({ onlySongs }),
      setHideWhenPaused: (hideWhenPaused) => set({ hideWhenPaused }),
    }),
    { name: "ytm-discord" },
  ),
);

/** True once there's enough to actually connect: enabled + a Client ID
 *  (the shipped default counts — it's a real, working application). */
export function isDiscordConfigured(state: {
  enabled: boolean;
  applicationId: string;
}): boolean {
  return state.enabled && !!state.applicationId;
}

/**
 * Mirror the connection half of the settings (enabled + Client ID) into
 * Rust, where the actual Discord IPC client lives. Mounted once in
 * AppShell: pushes the persisted value right after launch, then again on
 * every change from the Settings page. Content/filter toggles don't need
 * mirroring — they're applied to the payload in `audio-engine.ts` before
 * each `discord_update` call.
 */
export function useDiscordPresenceSync(): void {
  const enabled = useDiscordStore((s) => s.enabled);
  const applicationId = useDiscordStore((s) => s.applicationId);
  const configured = isDiscordConfigured({ enabled, applicationId });
  useEffect(() => {
    invoke("discord_set_config", {
      enabled: configured,
      applicationId: configured ? applicationId : "",
    }).catch(() => {
      /* plain-vite dev without a Tauri backend — nothing to sync */
    });
  }, [configured, applicationId]);
}
