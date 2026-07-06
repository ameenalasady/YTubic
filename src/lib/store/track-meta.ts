import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TrackMeta = {
  title: string;
  /** Free-form line under the title — artist(s), channel, or album. */
  subtitle?: string;
  artists?: { id?: string; name: string }[];
};

// Soft cap so the map can't outgrow the localStorage quota it shares with
// the query cache and other stores. Cache tops out in the low thousands of
// tracks even at the largest storage limit, so this comfortably covers a
// full cache with headroom. Oldest insertions are evicted first.
const MAX_ENTRIES = 5000;

type State = {
  /** videoId → metadata. Populated at play time (rich YT Music metadata)
   *  and back-filled from YouTube oEmbed for tracks cached before this
   *  store existed. */
  byId: Record<string, TrackMeta>;
  remember: (videoId: string, meta: TrackMeta) => void;
};

/**
 * Persistent title/artist registry for cached tracks.
 *
 * The on-disk audio cache is keyed purely by videoId, so the Cache settings
 * list has nothing but the id to show unless we remember what each track
 * *was*. Every played track flows through `rememberTrack` (see the audio
 * engine), which is exactly the set of tracks that get cached — so going
 * forward the list always has a real title. Pre-existing cache entries are
 * back-filled lazily via oEmbed (see `track-meta-fetch`).
 */
export const useTrackMetaStore = create<State>()(
  persist(
    (set, get) => ({
      byId: {},
      remember: (videoId, meta) => {
        if (!videoId || !meta.title) return;
        const existing = get().byId[videoId];
        // Don't let a thin oEmbed record (channel name, no artist array)
        // clobber a richer play-time record that has structured artists.
        if (existing?.artists?.length && !meta.artists?.length) return;
        set((s) => {
          const byId = { ...s.byId, [videoId]: meta };
          const keys = Object.keys(byId);
          if (keys.length > MAX_ENTRIES) {
            for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
              delete byId[k];
            }
          }
          return { byId };
        });
      },
    }),
    {
      name: "ytm-track-meta",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Record a played track's metadata. Cheap, idempotent, safe to call on
 *  every track change. */
export function rememberTrack(track: {
  videoId: string;
  title?: string;
  subtitle?: string;
  artists?: { id?: string; name: string }[];
}): void {
  if (!track.title) return;
  useTrackMetaStore.getState().remember(track.videoId, {
    title: track.title,
    subtitle: track.subtitle,
    artists: track.artists,
  });
}
