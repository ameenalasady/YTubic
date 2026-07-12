import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  scrobble,
  updateNowPlaying,
  type LastfmScrobbleTrack,
} from "@/lib/lastfm/api";
import { enqueue, flushQueue, isTransient } from "@/lib/lastfm/queue";
import { toLastfmTrack } from "@/lib/lastfm/track";
import { getLastfmSession, useLastfmStore } from "@/lib/store/lastfm";
import { usePlaybackStore, type QueueTrack } from "@/lib/store/playback";

/**
 * Last.fm scrobbler. Mount once near the app root (AppShell, main window
 * only — the floating player doesn't run playback). It watches the playback
 * store and:
 *
 *   • sends `track.updateNowPlaying` when a track starts, and
 *   • scrobbles it once it has been *actually* played for at least half its
 *     length or 4 minutes, whichever comes first (the Last.fm rule). Tracks
 *     shorter than 30 seconds are never scrobbled.
 *
 * Play time is accumulated with a 1-second interval that only ticks while
 * `playing` is true, so pausing or seeking backward can't fake a scrobble.
 */

/** Minimum track length Last.fm accepts for scrobbling. */
const MIN_SCROBBLE_DURATION = 30;
/** Scrobble after half the track, capped at 4 minutes. */
const MAX_SCROBBLE_THRESHOLD = 240;

type Session = {
  videoId: string | undefined;
  index: number;
  /** Unix seconds when this play started (the scrobble timestamp). */
  startTs: number;
  /** Whole seconds actually played (interval-accumulated). */
  listened: number;
  scrobbled: boolean;
  nowPlayingSent: boolean;
};

function toScrobbleTrack(
  t: QueueTrack,
  realDuration: number,
): LastfmScrobbleTrack | null {
  const base = toLastfmTrack(t);
  if (!base) return null;
  return { ...base, duration: realDuration > 0 ? realDuration : t.duration };
}

function logDev(prefix: string, e: unknown): void {
  if (import.meta.env.DEV) console.warn(`[lastfm] ${prefix}`, e);
}

/** Send now-playing for whatever track is current. No-op if not linked. */
function sendNowPlaying(): void {
  const session = getLastfmSession();
  if (!session) return;
  const s = usePlaybackStore.getState();
  const t = s.index >= 0 ? s.queue[s.index] : undefined;
  if (!t) return;
  const st = toScrobbleTrack(t, s.duration);
  if (!st) return;
  void updateNowPlaying(session.creds, session.sessionKey, st).catch((e) =>
    logDev("updateNowPlaying failed", e),
  );
}

/** Scrobble the current track with the given start timestamp. Failures that
 *  look transient (offline, Last.fm hiccup) are queued for retry rather than
 *  dropped. */
function sendScrobble(timestamp: number): void {
  const session = getLastfmSession();
  if (!session) return;
  const s = usePlaybackStore.getState();
  const t = s.index >= 0 ? s.queue[s.index] : undefined;
  if (!t) return;
  const st = toScrobbleTrack(t, s.duration);
  if (!st) return;
  scrobble(session.creds, session.sessionKey, st, timestamp)
    .then(() => {
      // A successful send means we're online again — drain anything
      // stranded from earlier.
      void flushQueue(session.creds, session.sessionKey);
    })
    .catch((e) => {
      logDev("scrobble failed", e);
      if (isTransient(e)) {
        enqueue({ ...st, timestamp, sessionKey: session.sessionKey });
      }
    });
}

export function useLastfmScrobbler(): void {
  // Only run the machinery when the user is fully linked and hasn't paused
  // scrobbling — otherwise the interval and effects are inert.
  const active = useLastfmStore(
    (s) => s.scrobblingEnabled && !!s.apiKey && !!s.apiSecret && !!s.sessionKey,
  );

  const { videoId, index } = usePlaybackStore(
    useShallow((s) => ({
      videoId: s.index >= 0 ? s.queue[s.index]?.videoId : undefined,
      index: s.index,
    })),
  );
  const playing = usePlaybackStore((s) => s.playing);

  // Retry anything stranded offline from a previous session, once linking
  // (re)activates.
  useEffect(() => {
    if (!active) return;
    const session = getLastfmSession();
    if (!session) return;
    void flushQueue(session.creds, session.sessionKey);
  }, [active]);

  const sessionRef = useRef<Session>({
    videoId: undefined,
    index: -1,
    startTs: 0,
    listened: 0,
    scrobbled: false,
    nowPlayingSent: false,
  });

  // A new current track (or (re)activation) starts a fresh scrobble session.
  useEffect(() => {
    const sess = sessionRef.current;
    sess.videoId = videoId;
    sess.index = index;
    sess.startTs = Math.floor(Date.now() / 1000);
    sess.listened = 0;
    sess.scrobbled = false;
    sess.nowPlayingSent = false;
    if (!active || !videoId) return;
    if (usePlaybackStore.getState().playing) {
      sess.nowPlayingSent = true;
      sendNowPlaying();
    }
  }, [videoId, index, active]);

  // Catch the case where the current track was loaded while paused (e.g. a
  // queue restored at launch) and the user then presses play — the effect
  // above ran with playing=false, so now-playing hasn't gone out yet.
  useEffect(() => {
    if (!active || !playing || !videoId) return;
    const sess = sessionRef.current;
    if (sess.nowPlayingSent || sess.scrobbled) return;
    sess.nowPlayingSent = true;
    sendNowPlaying();
  }, [playing, active, videoId]);

  // Accumulate real play time and fire the scrobble at the threshold.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const s = usePlaybackStore.getState();
      if (!s.playing) return;
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      const sess = sessionRef.current;
      // If the store moved on before the track-change effect re-synced the
      // session, skip this tick — the effect will reset us next commit.
      if (!t || t.videoId !== sess.videoId || s.index !== sess.index) return;

      // Repeat-one / loop: the same slot jumped back to the start after a
      // substantial listen → treat it as a brand-new play so it scrobbles
      // again with a fresh timestamp.
      if (sess.scrobbled && s.position < 1.5 && sess.listened > 30) {
        sess.startTs = Math.floor(Date.now() / 1000);
        sess.listened = 0;
        sess.scrobbled = false;
        sess.nowPlayingSent = true;
        sendNowPlaying();
        return;
      }

      sess.listened += 1;
      if (sess.scrobbled) return;
      const duration = s.duration > 0 ? s.duration : (t.duration ?? 0);
      if (duration < MIN_SCROBBLE_DURATION) return;
      const threshold = Math.min(duration / 2, MAX_SCROBBLE_THRESHOLD);
      if (sess.listened >= threshold) {
        sess.scrobbled = true;
        sendScrobble(sess.startTs);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [active]);
}
