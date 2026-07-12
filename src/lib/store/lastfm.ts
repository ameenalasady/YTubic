import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LastfmCreds } from "@/lib/lastfm/api";

type State = {
  /** The user's own Last.fm API application key. */
  apiKey: string;
  /** The matching shared secret, used to sign requests. */
  apiSecret: string;
  /** Long-lived session key from the desktop auth flow, or null if not linked. */
  sessionKey: string | null;
  /** Last.fm username for the linked session (for display). */
  username: string | null;
  /** Profile avatar URL for the linked account (from user.getInfo), purely
   *  cosmetic for the account card, or null if not fetched/unavailable. */
  avatarUrl: string | null;
  /**
   * Master switch. A user can stay linked but pause scrobbling — nothing is
   * sent to Last.fm while this is false.
   */
  scrobblingEnabled: boolean;
  /**
   * When true, liking a track in YTubic also loves it on Last.fm (and
   * unliking unloves it). Independent of scrobbling.
   */
  loveSyncEnabled: boolean;

  setCredentials: (apiKey: string, apiSecret: string) => void;
  setSession: (sessionKey: string, username: string) => void;
  setAvatarUrl: (avatarUrl: string | null) => void;
  setScrobblingEnabled: (on: boolean) => void;
  setLoveSyncEnabled: (on: boolean) => void;
  /** Drop the linked session (keeps the API key/secret for easy re-linking). */
  disconnect: () => void;
};

/**
 * Last.fm account + preferences, persisted to localStorage alongside the
 * app's other zustand stores. The scrobbler (`useLastfmScrobbler`) and the
 * Settings card both read/write this; non-React callers use
 * `getLastfmSession()` for a synchronous snapshot.
 *
 * The API key/secret are the user's own (entered in Settings) — nothing is
 * embedded in the app. localStorage is adequate for a desktop app: the
 * webview storage is per-user and local, and the "secret" is only used to
 * sign Last.fm requests client-side, exactly as their desktop flow intends.
 */
export const useLastfmStore = create<State>()(
  persist(
    (set) => ({
      apiKey: "",
      apiSecret: "",
      sessionKey: null,
      username: null,
      avatarUrl: null,
      scrobblingEnabled: true,
      loveSyncEnabled: true,

      setCredentials: (apiKey, apiSecret) =>
        set({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      setSession: (sessionKey, username) =>
        set({ sessionKey, username, avatarUrl: null }),
      setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
      setScrobblingEnabled: (scrobblingEnabled) => set({ scrobblingEnabled }),
      setLoveSyncEnabled: (loveSyncEnabled) => set({ loveSyncEnabled }),
      disconnect: () => set({ sessionKey: null, username: null, avatarUrl: null }),
    }),
    { name: "ytm-lastfm" },
  ),
);

/** True when we have credentials AND an authorised session key. */
export function isLastfmLinked(state: {
  apiKey: string;
  apiSecret: string;
  sessionKey: string | null;
}): boolean {
  return !!state.apiKey && !!state.apiSecret && !!state.sessionKey;
}

/**
 * Synchronous snapshot of the linked credentials + session key, ignoring
 * the per-feature toggles. Returns null when not fully linked. Callers gate
 * on `scrobblingEnabled` / `loveSyncEnabled` themselves.
 */
export function getLastfmLink():
  | { creds: LastfmCreds; sessionKey: string }
  | null {
  const s = useLastfmStore.getState();
  if (!isLastfmLinked(s) || !s.sessionKey) return null;
  return {
    creds: { apiKey: s.apiKey, apiSecret: s.apiSecret },
    sessionKey: s.sessionKey,
  };
}

/** Linked session for the scrobbler — null unless scrobbling is enabled. */
export function getLastfmSession():
  | { creds: LastfmCreds; sessionKey: string }
  | null {
  if (!useLastfmStore.getState().scrobblingEnabled) return null;
  return getLastfmLink();
}
