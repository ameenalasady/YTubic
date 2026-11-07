import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { findAlternateVideoId } from "@/lib/innertube/alternate-source";
import type { QueueTrack } from "@/lib/store/playback";
import { useTrackSourceStore, type SourceKind } from "@/lib/store/track-source";

/** Tracks (this session) for which no matching version of a kind exists. */
const useMissingSources = create<{
  missing: Record<string, true>;
  mark: (key: string) => void;
}>((set) => ({
  missing: {},
  mark: (key) => set((s) => ({ missing: { ...s.missing, [key]: true } })),
}));

/**
 * Song ↔ Video source switch for one track, the same lookup the player
 * menu uses: the first switch to Video searches for the track's music
 * video and remembers its id; later switches are instant. Choosing Video
 * also makes the audio come from that video, which keeps the picture and
 * the sound on the same timeline.
 *
 * `unavailable` is true once a lookup found no convincing match for the
 * current track, so the UI can say so instead of showing something else.
 */
export function useSourceSwitch(track: QueueTrack) {
  const record = useTrackSourceStore((s) => s.byVideoId[track.videoId]);
  const setSelected = useTrackSourceStore((s) => s.setSelected);
  const setAlternate = useTrackSourceStore((s) => s.setAlternate);
  const markMissing = useMissingSources((s) => s.mark);
  const missing = useMissingSources((s) => s.missing);
  // Which track a lookup is running for, so a track change mid-lookup
  // neither blocks the new track's switch nor lands on the wrong track.
  const [busyState, setBusyState] = useState<{
    id: string;
    kind: SourceKind;
  } | null>(null);
  const busyIdRef = useRef<string | null>(null);
  const currentIdRef = useRef(track.videoId);
  useEffect(() => {
    currentIdRef.current = track.videoId;
  }, [track.videoId]);

  const selected: SourceKind = record?.selected ?? "song";
  const busy = busyState?.id === track.videoId ? busyState.kind : null;
  const unavailable = !!missing[`${track.videoId}:video`];

  const switchTo = useCallback(
    async (target: SourceKind, silent = false): Promise<boolean> => {
      const id = track.videoId;
      if (busyIdRef.current === id || target === selected) return false;
      const cachedAlt = target === "video" ? record?.video : record?.song;
      if (cachedAlt) {
        setSelected(id, target);
        return true;
      }
      const missingKey = `${id}:${target}`;
      // Automatic (sticky) switches do not search again for a track that
      // already came up empty; an explicit click does, in case it was a
      // network hiccup.
      if (silent && useMissingSources.getState().missing[missingKey]) {
        return false;
      }
      busyIdRef.current = id;
      setBusyState({ id, kind: target });
      try {
        const artistsLine = track.artists?.map((a) => a.name).join(" ") ?? "";
        const query = `${track.title} ${artistsLine}`.trim();
        const altId = await findAlternateVideoId(query, id, target, {
          title: track.title,
          artists: track.artists?.map((a) => a.name),
          duration: track.duration,
        });
        if (!altId) {
          markMissing(missingKey);
          if (!silent) {
            toast.error(
              target === "video"
                ? "No video available for this track"
                : "No song version found",
            );
          }
          return false;
        }
        setAlternate(id, target, altId);
        // The user may have moved on while this was searching: an
        // automatic switch must not flip the source of a track that is
        // no longer playing.
        if (silent && currentIdRef.current !== id) return false;
        setSelected(id, target);
        return true;
      } catch (e) {
        if (!silent) {
          toast.error(`Couldn't switch source: ${(e as Error).message}`);
        }
        return false;
      } finally {
        busyIdRef.current = null;
        setBusyState(null);
      }
    },
    [record, selected, setAlternate, setSelected, markMissing, track],
  );

  return { selected, busy, unavailable, switchTo };
}
