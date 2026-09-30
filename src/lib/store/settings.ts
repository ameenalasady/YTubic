import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CloseButtonAction = "tray" | "quit";
export type CacheAutoCleanPeriod = "off" | "daily" | "weekly" | "monthly";
export type BackgroundMode = "ambient" | "plain";
/** Typeface for the whole UI. Stacks live in `lib/interface-font.ts`. */
export type InterfaceFont = "system" | "gsans" | "inter" | "roboto" | "plex";
/** One heart, or a thumbs-up / thumbs-down pair. */
export type RatingButtons = "heart" | "both";
/** How the full-screen now-playing view fills the window
 *  (see `components/layout/fullscreen-player.tsx`). */
export type FullscreenLayout = "cover" | "lyrics" | "immersive";

type State = {
  /** What the title-bar ✕ does: hide to tray (default) or quit. */
  closeAction: CloseButtonAction;
  /** Cadence of the background sweep that deletes cached tracks not
   *  in the user's library (see `lib/cache-cleanup.ts`). */
  cacheAutoClean: CacheAutoCleanPeriod;
  /** Unix ms of the last completed sweep. 0 = never ran. */
  lastCacheCleanAt: number;
  /** Window backdrop: "ambient" tints with blurred album art,
   *  "plain" keeps the flat theme background. */
  background: BackgroundMode;
  /** Typeface applied to the document root (see `lib/interface-font.ts`). */
  interfaceFont: InterfaceFont;
  /** How tracks are rated: a single heart, or like + dislike thumbs.
   *  Dislikes are remembered locally in `store/dislikes.ts`. */
  ratingButtons: RatingButtons;
  /** Body of the full-screen player: cover centred, cover with the
   *  lyrics beside it, or the art itself behind the title. */
  fullscreenLayout: FullscreenLayout;
  /** System toast on track change while the app is in the background
   *  (see `lib/playback-notifications.ts`). */
  playbackNotifications: boolean;
  /** Master on/off for the lyrics panel, shared by the side card and
   *  the floating window (see `components/layout/lyrics-view.tsx`).
   *  Off skips the three lyrics-source fetches and unmounts the
   *  synced-scroll view entirely, saving network + rAF/CPU cost for
   *  users who don't use lyrics. (Fork.) */
  lyricsEnabled: boolean;
  /** Check GitHub Releases at launch and download a newer version in
   *  the background, leaving only the restart to the user (see
   *  `lib/updater.ts`). Off: no check at launch, and a check run from
   *  About only reports the version, downloading waits for a click.
   *  (Upstream bcb0bbb; fork's Discord/Last.fm live in separate stores,
   *  so only autoUpdate is ported here.) */
  autoUpdate: boolean;
  /** Accent-colored glowing outline around the window edge
   *  (see `components/layout/window-glow.tsx`). */
  windowGlow: boolean;
  /** Tint the glow with the current cover's dominant color. */
  windowGlowCover: boolean;
  /** Glow thickness, 10-100 (50 = default). */
  windowGlowSize: number;
  setCloseAction: (v: CloseButtonAction) => void;
  setCacheAutoClean: (v: CacheAutoCleanPeriod) => void;
  markCacheCleaned: () => void;
  setBackground: (v: BackgroundMode) => void;
  setInterfaceFont: (v: InterfaceFont) => void;
  setRatingButtons: (v: RatingButtons) => void;
  setFullscreenLayout: (v: FullscreenLayout) => void;
  setPlaybackNotifications: (v: boolean) => void;
  setLyricsEnabled: (v: boolean) => void;
  setAutoUpdate: (v: boolean) => void;
  setWindowGlow: (v: boolean) => void;
  setWindowGlowCover: (v: boolean) => void;
  setWindowGlowSize: (v: number) => void;
};

/**
 * General app preferences editable from the Settings page. Persisted
 * in localStorage like the other stores; anything Rust needs to act on
 * (close behavior) is mirrored over IPC by a sync hook rather than
 * read from disk on the Rust side.
 */
export const useSettingsStore = create<State>()(
  persist(
    (set) => ({
      closeAction: "tray",
      cacheAutoClean: "off",
      lastCacheCleanAt: 0,
      background: "ambient",
      interfaceFont: "system",
      ratingButtons: "heart",
      fullscreenLayout: "cover",
      playbackNotifications: false,
      lyricsEnabled: true,
      autoUpdate: true,
      windowGlow: true,
      windowGlowCover: true,
      windowGlowSize: 50,
      setCloseAction: (closeAction) => set({ closeAction }),
      setCacheAutoClean: (cacheAutoClean) => set({ cacheAutoClean }),
      markCacheCleaned: () => set({ lastCacheCleanAt: Date.now() }),
      setBackground: (background) => set({ background }),
      setInterfaceFont: (interfaceFont) => set({ interfaceFont }),
      setRatingButtons: (ratingButtons) => set({ ratingButtons }),
      setFullscreenLayout: (fullscreenLayout) => set({ fullscreenLayout }),
      setPlaybackNotifications: (playbackNotifications) =>
        set({ playbackNotifications }),
      setLyricsEnabled: (lyricsEnabled) => set({ lyricsEnabled }),
      setAutoUpdate: (autoUpdate) => set({ autoUpdate }),
      setWindowGlow: (windowGlow) => set({ windowGlow }),
      setWindowGlowCover: (windowGlowCover) => set({ windowGlowCover }),
      setWindowGlowSize: (v) =>
        set({ windowGlowSize: Math.min(100, Math.max(10, Math.round(v))) }),
    }),
    { name: "ytm-settings" },
  ),
);

// The main and floating-player windows are separate JS contexts sharing
// the `ytm-settings` localStorage key (same pattern as `ytm-layout`).
// Re-hydrate on the cross-window `storage` event so e.g. switching the
// Background mode in the main window restyles the floating player live.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "ytm-settings") {
      void useSettingsStore.persist.rehydrate();
    }
  });
}

/**
 * Mirror the persisted close-button preference into Rust, where the
 * actual `CloseRequested` handling lives (it must cover every close
 * path — title-bar ✕, Alt+F4, taskbar Close). Mounted once in
 * AppShell: pushes the persisted value right after launch, then again
 * on every change from the Settings page.
 */
export function useCloseBehaviorSync(): void {
  const closeAction = useSettingsStore((s) => s.closeAction);
  useEffect(() => {
    invoke("set_close_behavior", {
      quitOnClose: closeAction === "quit",
    }).catch(() => {
      /* plain-vite dev without a Tauri backend — nothing to sync */
    });
  }, [closeAction]);
}
