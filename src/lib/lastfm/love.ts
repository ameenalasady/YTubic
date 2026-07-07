import { love, unlove } from "@/lib/lastfm/api";
import { toLastfmTrack, type LastfmTrackMeta } from "@/lib/lastfm/track";
import { getLastfmLink, useLastfmStore } from "@/lib/store/lastfm";

/**
 * Mirror a like/unlike to Last.fm's loved-tracks list. Fire-and-forget:
 * a Last.fm failure must never block or reverse the YouTube Music rating,
 * so errors are swallowed (logged in dev only).
 *
 * No-op unless the account is linked and love-sync is enabled.
 */
export function syncLastfmLove(meta: LastfmTrackMeta, loved: boolean): void {
  if (!useLastfmStore.getState().loveSyncEnabled) return;
  const link = getLastfmLink();
  if (!link) return;
  const t = toLastfmTrack(meta);
  if (!t) return;
  const fn = loved ? love : unlove;
  void fn(link.creds, link.sessionKey, t).catch((e) => {
    if (import.meta.env.DEV) {
      console.warn(`[lastfm] ${loved ? "love" : "unlove"} failed`, e);
    }
  });
}
