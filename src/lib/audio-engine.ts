import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { fetchRadio, fetchShuffleContinuation } from "@/lib/innertube/radio";
import { prefetchStream, streamUrlFor } from "@/lib/stream";
import { usePlaybackStore, type QueueTrack } from "@/lib/store/playback";
import {
  resolveStreamId,
  useTrackSourceStore,
} from "@/lib/store/track-source";
import { pickThumbnail } from "@/components/shared/thumbnail";
import { rememberTrack } from "@/lib/store/track-meta";
import {
  loadPlaybackPosition,
  savePlaybackPosition,
} from "@/lib/store/playback-position";
import { useDiscordStore, isDiscordConfigured } from "@/lib/store/discord";

/**
 * AudioEngine binds the playback store to a singleton HTMLAudioElement
 * and drives the OS media controls (Windows SMTC / Linux MPRIS) from Rust
 * via souvlaki (see the media effects below and src-tauri/src/media.rs)
 * rather than the webview's own media session — that one either shows up
 * as "Unknown app" (Windows, WebView2 child process) or doesn't bridge to
 * the desktop at all (Linux, WebKitGTK).
 *
 * Mount this hook once, near the root. It owns the <audio> element's lifecycle.
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Guard against stale stream resolutions when the user skips mid-fetch.
  const resolveTokenRef = useRef(0);
  // Counts how many tracks have failed in a row without a successful
  // play in between. Reset to 0 on `playing`. Used to short-circuit
  // auto-skip after a few consecutive failures so we don't burn through
  // the whole queue if e.g. the network is dead.
  const consecutiveErrorsRef = useRef(0);
  // Remembers the `videoId:index` we've already auto-retried once, so a
  // track that keeps failing falls through to the normal error/skip path
  // instead of looping. Cleared on a successful `playing`.
  const retriedTrackRef = useRef<string | null>(null);
  // Bumping this re-runs the resolve effect for the *current* track
  // without any of its real deps changing — used to re-fetch a fresh
  // stream URL after a transient failure (e.g. a googlevideo 403).
  const [retryNonce, setRetryNonce] = useState(0);
  // Resume point captured once at startup. Consumed when the restored track's
  // media loads (see the stream-resolve effect), then nulled so later track
  // changes start from 0.
  const resumeRef = useRef(loadPlaybackPosition());

  // Seed the progress bar with the saved position immediately (before the
  // stream resolves) when the restored current track matches the saved one.
  useEffect(() => {
    const resume = resumeRef.current;
    if (!resume) return;
    const s = usePlaybackStore.getState();
    const currentVideoId = s.index >= 0 ? s.queue[s.index]?.videoId : undefined;
    if (currentVideoId === resume.videoId) {
      s.setPosition(resume.position);
    } else {
      // Saved position belongs to a track that's no longer current — drop it.
      resumeRef.current = null;
    }
    // Run once on mount against the rehydrated store.
  }, []);

  // Ensure a single <audio> element exists.
  useEffect(() => {
    if (audioRef.current) return;
    const el = new Audio();
    el.preload = "auto";
    // Note: do NOT set crossOrigin — googlevideo.com doesn't return CORS
    // headers, and setting it makes the media fail to load in the webview.
    audioRef.current = el;
    return () => {
      el.pause();
      el.src = "";
      audioRef.current = null;
    };
  }, []);

  // Wire element → store events.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const store = usePlaybackStore.getState;

    const persistPosition = (force: boolean) => {
      const s = store();
      const vid = s.index >= 0 ? s.queue[s.index]?.videoId : undefined;
      if (vid) savePlaybackPosition(vid, el.currentTime, force);
    };
    let lastPositionSync = 0;
    const syncPosition = () => {
      const now = performance.now();
      if (now - lastPositionSync < 750) return;
      lastPositionSync = now;
      store().setPosition(el.currentTime);
      persistPosition(false);
    };
    const flushPosition = () => {
      lastPositionSync = performance.now();
      store().setPosition(el.currentTime);
      // Pause / seek / ended — snapshot the exact spot so a close right
      // after doesn't lose the last few seconds.
      persistPosition(true);
    };
    const onTimeUpdate = syncPosition;
    const onDurationChange = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        store().setDuration(el.duration);
      }
    };
    const onEnded = () => {
      flushPosition();
      store().next();
    };
    const onError = () => {
      const mediaErr = el.error;
      const codeLabels: Record<number, string> = {
        1: "MEDIA_ERR_ABORTED",
        2: "MEDIA_ERR_NETWORK",
        3: "MEDIA_ERR_DECODE",
        4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
      };
      const msg = mediaErr
        ? `${codeLabels[mediaErr.code] ?? `code ${mediaErr.code}`}${
            mediaErr.message ? `: ${mediaErr.message}` : ""
          }`
        : "Unknown audio error";
      if (import.meta.env.DEV) {
        console.error("[audio] element error:", msg, "src=", el.currentSrc);
      }

      // One automatic retry of the SAME track before giving up. Most
      // first-play failures are a transient googlevideo 403 on the media
      // URL: the stream server drops the failed entry immediately, so a
      // re-fetch spawns a fresh yt-dlp resolve that usually succeeds —
      // exactly what a manual re-click does. Only retry a track the user
      // actively wants playing, and only once per track instance.
      {
        const s0 = store();
        const cur0 = s0.index >= 0 ? s0.queue[s0.index] : undefined;
        const key0 = cur0 ? `${cur0.videoId}:${s0.index}` : null;
        if (s0.playing && key0 && retriedTrackRef.current !== key0) {
          retriedTrackRef.current = key0;
          if (import.meta.env.DEV) {
            console.warn("[audio] retrying", key0, "after error:", msg);
          }
          store().setStatus("loading");
          // Small delay so a truly-dead source doesn't hot-loop; also
          // gives the server a beat to tear down the failed download.
          window.setTimeout(() => setRetryNonce((n) => n + 1), 400);
          return;
        }
      }

      store().setStatus("error", msg);

      // Auto-advance: if the user wanted playback and we have a next
      // track, try it. Stop after 3 consecutive failures so a dead
      // network or a poisoned playlist doesn't burn through everything.
      const s = store();
      const hasNext = s.index >= 0 && s.index + 1 < s.queue.length;
      consecutiveErrorsRef.current += 1;
      if (s.playing && hasNext && consecutiveErrorsRef.current <= 3) {
        // Keep `playing: true` so the new track auto-resumes.
        s.next();
      } else {
        s.setPlaying(false);
      }
    };
    const onPlaying = () => {
      consecutiveErrorsRef.current = 0;
      // Track played successfully — allow a fresh auto-retry if it later
      // fails again (e.g. a mid-stream drop on a much later replay).
      retriedTrackRef.current = null;
      store().setStatus("ready");
    };
    const onWaiting = () => {
      // buffering — keep status as ready; don't flip to loading on every gap.
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", flushPosition);
    el.addEventListener("seeking", flushPosition);
    el.addEventListener("waiting", onWaiting);
    // Final flush when the window is closing/hidden so we don't lose the
    // last (throttled) few seconds of the current playhead.
    const onHide = () => persistPosition(true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", flushPosition);
      el.removeEventListener("seeking", flushPosition);
      el.removeEventListener("waiting", onWaiting);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // React to current-track changes → resolve stream → set src.
  const { videoId, track, index } = usePlaybackStore(
    useShallow((s) => {
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      return { videoId: t?.videoId, track: t, index: s.index };
    }),
  );

  // Remember the current track's title/artists keyed by videoId. Playing a
  // track is exactly what caches it on disk, so this keeps the Cache settings
  // list able to show real titles instead of bare video ids.
  useEffect(() => {
    if (track?.videoId && track.title) rememberTrack(track);
  }, [track]);

  // Substitute the streaming videoId via the user's per-track source
  // preference (Song ↔ Music Video). Subscribing here means the effect
  // below re-runs and re-resolves the stream when the user toggles the
  // source on the currently playing track.
  const streamVideoId = useTrackSourceStore((s) =>
    videoId ? resolveStreamId(videoId, s.byVideoId) : undefined,
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // Stop the previous track immediately. Without this the old src keeps
    // playing through the streamUrlFor() round-trip (~50–500 ms), so the
    // user hears the tail of track A bleed into the start of track B.
    el.pause();
    if (!streamVideoId) {
      el.removeAttribute("src");
      el.load();
      usePlaybackStore.getState().setStreamUrl(undefined);
      return;
    }
    // Drop the previous track's src immediately. Otherwise a paused→playing
    // transition committed together with the track change (playNow/goTo set
    // playing: true) makes the [playing] effect below re-play the OLD src
    // for the duration of the streamUrlFor() round-trip.
    el.removeAttribute("src");

    const token = ++resolveTokenRef.current;
    usePlaybackStore.getState().setStatus("loading");

    // Playback goes through our local streaming HTTP server. It spawns
    // yt-dlp and pipes the audio bytes progressively so playback starts
    // as soon as the first chunk lands (typically ~200ms after the
    // yt-dlp subprocess starts emitting bytes).
    streamUrlFor(streamVideoId)
      .then((src) => {
        if (token !== resolveTokenRef.current) return;
        if (import.meta.env.DEV) {
          console.debug("[audio] setting src for", videoId, "→", src);
        }
        el.src = src;
        usePlaybackStore.getState().setStreamUrl(src);
        el.load();
        // Resume the restored track at its saved playhead once metadata is
        // ready (currentTime can't be set before the media is seekable).
        // One-shot: only the first track after launch, only if it's the one
        // the position was saved for.
        const resume = resumeRef.current;
        if (resume && resume.videoId === videoId) {
          resumeRef.current = null;
          const seekToResume = () => {
            el.removeEventListener("loadedmetadata", seekToResume);
            if (token !== resolveTokenRef.current) return;
            try {
              el.currentTime = resume.position;
              usePlaybackStore.getState().setPosition(resume.position);
            } catch {
              /* not seekable yet — leave at 0 */
            }
          };
          el.addEventListener("loadedmetadata", seekToResume);
        }
        if (usePlaybackStore.getState().playing) {
          void el.play().catch((e) => {
            // AbortError is what we get when a pending play() is
            // interrupted by a new load (e.g. user clicked the next
            // track before the current one started). It's harmless
            // and should never surface to the user.
            if (e?.name === "AbortError") return;
            if (import.meta.env.DEV) {
              console.error("[audio] play() rejected:", e);
            }
            usePlaybackStore
              .getState()
              .setStatus("error", e?.message ?? String(e));
          });
        }
      })
      .catch((e: Error) => {
        if (token !== resolveTokenRef.current) return;
        usePlaybackStore.getState().setStatus("error", e.message);
        usePlaybackStore.getState().setPlaying(false);
      });
    // `index` is in the deps so advancing to a different queue slot that
    // holds the *same* videoId (a duplicate in a playlist, radio dupes)
    // still re-resolves and plays instead of stalling on "loading" —
    // videoId/streamVideoId alone wouldn't change. Repeating a *single*
    // track (repeat-one, or repeat-all on a 1-track queue) keeps the same
    // index, so the store replays it via pendingSeek instead — see
    // `next()` in store/playback.ts.
    // `retryNonce` so the error handler can force a fresh stream-URL fetch
    // for the current track after a transient failure without changing id.
  }, [streamVideoId, videoId, index, retryNonce]);

  // Play / pause follow store.
  const playing = usePlaybackStore((s) => s.playing);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.src) return;
    if (playing) {
      void el.play().catch((e) => {
        if (e?.name === "AbortError") return;
        usePlaybackStore.getState().setStatus("error", e?.message ?? String(e));
      });
    } else {
      el.pause();
    }
  }, [playing]);

  // Volume / mute follow store.
  const volume = usePlaybackStore((s) => s.volume);
  const muted = usePlaybackStore((s) => s.muted);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // <audio>.volume is linear amplitude (0..1), but loudness perception
    // is logarithmic — a linear slider crams almost all the perceivable
    // change into the bottom ~20% and 20–100% sounds nearly identical.
    // Apply a cubic curve so the slider tracks perceived loudness.
    const clamped = Math.max(0, Math.min(1, volume));
    el.volume = clamped ** 3;
    el.muted = muted;
  }, [volume, muted]);

  // Handle seek requests.
  const pendingSeek = usePlaybackStore((s) => s.pendingSeek);
  useEffect(() => {
    const el = audioRef.current;
    if (!el || pendingSeek === undefined) return;
    try {
      el.currentTime = pendingSeek;
      usePlaybackStore.getState().setPosition(pendingSeek);
    } catch {
      /* seek failed — non-fatal */
    }
    usePlaybackStore.getState().clearPendingSeek();
    // repeat-one and error auto-advance re-select the same track and set
    // { pendingSeek: 0, playing: true } without changing `playing` (already
    // true), so the [playing] effect never re-fires. After an `ended` event
    // the element is paused, so seeking to 0 alone leaves it silent. Resume
    // here when the store wants playback but the element is paused.
    if (usePlaybackStore.getState().playing && el.paused && el.src) {
      void el.play().catch((e) => {
        if (e?.name === "AbortError") return;
        usePlaybackStore
          .getState()
          .setStatus("error", e?.message ?? String(e));
      });
    }
  }, [pendingSeek]);

  // OS media controls (Windows SMTC / Linux MPRIS) are driven from Rust via
  // souvlaki, not navigator.mediaSession — see the docstring above. Metadata
  // / state is pushed by the media_update effect lower down; buttons come
  // back via the media-control listener below. See src-tauri/src/media.rs.

  // Tray menu commands come via a Tauri event. `cancelled` flag
  // protects against StrictMode's mount→unmount→mount race that
  // would otherwise leak duplicate listeners and double-call
  // `toggle()` (which would silently no-op the play/pause hotkey).
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void listen<string>("tray-action", (e) => {
      const store = usePlaybackStore.getState();
      if (e.payload === "play_pause") store.toggle();
      else if (e.payload === "prev") store.prev();
      else if (e.payload === "next") store.next();
    }).then((un) => {
      if (cancelled) un();
      else dispose = un;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // SMTC / MPRIS / media-key button presses arrive from Rust (souvlaki) as
  // a `media-control` event. Drive the store the same way the old
  // navigator.mediaSession action handlers did. `cancelled` guards against
  // StrictMode's mount→unmount→mount double-listen, like the tray listener.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void listen<{ action: string; position?: number }>(
      "media-control",
      (e) => {
        const store = usePlaybackStore.getState();
        switch (e.payload.action) {
          case "play":
            store.setPlaying(true);
            break;
          case "pause":
          case "stop":
            store.setPlaying(false);
            break;
          case "toggle":
            store.toggle();
            break;
          case "next":
            store.next();
            break;
          case "previous":
            store.prev();
            break;
          case "seek":
            if (typeof e.payload.position === "number")
              store.seek(e.payload.position);
            break;
        }
      },
    ).then((un) => {
      if (cancelled) un();
      else dispose = un;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Prefetch the next queued track in the background while the current
  // one plays. First-time plays take ~2s (yt-dlp resolve + first audio
  // chunk); by the time the user hits "next" the file is cached on
  // disk and playback starts instantly with full seek support.
  const status = usePlaybackStore((s) => s.status);
  const { nextVideoId } = usePlaybackStore(
    useShallow((s) => ({
      nextVideoId:
        s.index >= 0 && s.index + 1 < s.queue.length
          ? s.queue[s.index + 1].videoId
          : undefined,
    })),
  );
  // Substitute via source-prefs for the prefetch too — otherwise we'd
  // warm the cache for the wrong stream when the user has switched the
  // upcoming track to its video version.
  const nextStreamVideoId = useTrackSourceStore((s) =>
    nextVideoId ? resolveStreamId(nextVideoId, s.byVideoId) : undefined,
  );
  useEffect(() => {
    if (status !== "ready") return;
    if (!nextStreamVideoId) return;
    void prefetchStream(nextStreamVideoId);
  }, [status, nextStreamVideoId]);

  // Auto-extend the queue with radio tracks when we're near the end, so
  // playback continues past the explicit queue.
  const autoRadio = usePlaybackStore((s) => s.autoRadio);
  const stationContinuation = usePlaybackStore((s) => s.stationContinuation);
  const { qLen, qIndex, seedVideoId } = usePlaybackStore(
    useShallow((s) => ({
      qLen: s.queue.length,
      qIndex: s.index,
      seedVideoId:
        s.index >= 0 ? s.queue[s.index]?.videoId : undefined,
    })),
  );

  // A shuffle station (artist "Shuffle") only queues its first page up front;
  // page in the next one a few tracks before the end so the shuffle keeps
  // flowing seamlessly instead of running dry and cutting to radio.
  const STATION_EXTEND_LOOKAHEAD = 3;
  const stationFetchingRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!stationContinuation || qIndex < 0) return;
    if (qIndex < qLen - STATION_EXTEND_LOOKAHEAD) return;
    if (stationFetchingRef.current === stationContinuation) return;
    stationFetchingRef.current = stationContinuation;
    fetchShuffleContinuation(stationContinuation)
      .then(({ tracks, continuation }) => {
        const s = usePlaybackStore.getState();
        // Stale guard: the token may have changed (a new queue was loaded,
        // or a prior extension already advanced past this page).
        if (s.stationContinuation !== stationContinuation) return;
        const existing = new Set(s.queue.map((t) => t.videoId));
        const fresh = tracks.filter((t) => !existing.has(t.id));
        if (fresh.length) {
          s.appendToQueue(fresh);
          // Advance to the next page's token so the station can keep going.
          s.setStationContinuation(continuation);
        } else {
          // Page only replayed tracks we already have (RDAO continuations
          // overlap heavily near the tail) — stop extending rather than
          // chase dupe pages, and let auto-radio take over if enabled.
          s.setStationContinuation(undefined);
        }
      })
      .catch(() => {
        // Allow a retry on transient failure.
        stationFetchingRef.current = undefined;
      });
  }, [stationContinuation, qIndex, qLen]);

  const radioFetchedForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!autoRadio) return;
    // A shuffle station extends itself (above); don't also pile on radio.
    if (stationContinuation) return;
    if (qIndex < 0 || !seedVideoId) return;
    // Only fire when the current track is the last queued one.
    if (qIndex < qLen - 1) return;
    if (radioFetchedForRef.current === seedVideoId) return;
    radioFetchedForRef.current = seedVideoId;
    fetchRadio(seedVideoId)
      .then((tracks) => {
        // Guard against a stale fetch: the user may have replaced the queue
        // (playNow/setQueue) while the radio request was in flight. Only
        // append if this seed is still the current, last-in-queue track.
        const s = usePlaybackStore.getState();
        const cur = s.index >= 0 ? s.queue[s.index]?.videoId : undefined;
        if (cur !== seedVideoId || s.index < s.queue.length - 1) return;
        const rest = tracks.filter((t) => t.id !== seedVideoId);
        if (rest.length) s.appendToQueue(rest);
      })
      .catch(() => {
        // Allow a retry on transient failure.
        radioFetchedForRef.current = undefined;
      });
  }, [autoRadio, stationContinuation, qIndex, qLen, seedVideoId]);

  // Push metadata + playback state to the OS media controls (Windows SMTC /
  // Linux MPRIS) and, if configured, to Discord Rich Presence. The OS (and
  // Discord) interpolates the scrubber between pushes while the state is
  // Playing, so we don't push on every timeupdate — just on track /
  // play-state / duration change, plus a light 2s refresh while playing to
  // correct drift and reflect seeks. Live values are read imperatively so
  // this sync never re-triggers the resolve / playback effects above.
  const duration = usePlaybackStore((s) => s.duration);
  const discordSettings = useDiscordStore();
  useEffect(() => {
    const push = () => {
      const s = usePlaybackStore.getState();
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      if (!t) {
        void invoke("media_clear").catch(() => {});
        void invoke("discord_clear").catch(() => {});
        return;
      }
      void invoke("media_update", {
        title: t.title,
        artist: buildArtistLabel(t),
        album: t.album ?? "",
        thumbnail: pickThumbnail(t.thumbnails, 512) ?? "",
        duration: Number.isFinite(s.duration) ? s.duration : 0,
        elapsed: s.position,
        paused: !s.playing,
      }).catch(() => {});
      pushDiscordPresence(t, s, discordSettings);
    };
    push();
    if (!playing) return;
    const id = window.setInterval(push, 2000);
    return () => window.clearInterval(id);
  }, [track, playing, duration, discordSettings]);
}

function buildArtistLabel(track: QueueTrack): string {
  if (track.artists?.length) return track.artists.map((a) => a.name).join(", ");
  return track.subtitle ?? "";
}

/** A real album song has album metadata and isn't the toggled-to-video
 *  version of the pair; a standalone music video is neither. Used by the
 *  Discord "only show for songs" filter. */
function isAlbumSong(track: QueueTrack): boolean {
  const hasAlbumMeta = !!(track.album || track.albumId);
  const rec = useTrackSourceStore.getState().byVideoId[track.videoId];
  const isVideoVersion = rec?.selected === "video";
  return hasAlbumMeta && !isVideoVersion;
}

/**
 * Build and push the Discord Rich Presence payload, applying every
 * content/filter toggle from Settings → Integrations before it ever leaves
 * the frontend — `discord_update` on the Rust side just assembles whatever
 * non-empty fields it's handed (see src-tauri/src/discord.rs).
 */
function pushDiscordPresence(
  track: QueueTrack,
  playback: { position: number; duration: number; playing: boolean },
  d: ReturnType<typeof useDiscordStore.getState>,
): void {
  if (!isDiscordConfigured(d)) return;
  const paused = !playback.playing;
  if (d.hideWhenPaused && paused) {
    void invoke("discord_clear").catch(() => {});
    return;
  }
  if (d.onlySongs && !isAlbumSong(track)) {
    void invoke("discord_clear").catch(() => {});
    return;
  }
  const titleText = d.showTitle ? track.title : "";
  const artistText = d.showArtist ? buildArtistLabel(track) : "";
  // Discord's "before you expand it" member-list line always mirrors
  // whichever field `discord.rs` points `status_display_type` at (here,
  // `details`) — there's no separate combined-text slot for it. Folding
  // "Artist - Title" into `details` is what gets that summary line to read
  // as more than just the app's name.
  const details = [artistText, titleText].filter(Boolean).join(" - ");
  void invoke("discord_update", {
    payload: {
      name: d.presenceName,
      activityType: d.activityType,
      details,
      state: artistText,
      largeImage: d.showAlbumArt ? pickThumbnail(track.thumbnails, 512) ?? "" : "",
      largeText: d.showAlbumName ? track.album ?? "" : "",
      buttonLabel: d.showButton ? "Listen on YouTube Music" : "",
      buttonUrl: d.showButton
        ? `https://music.youtube.com/watch?v=${track.videoId}`
        : "",
      timestamps: d.showTimestamps,
      duration: Number.isFinite(playback.duration) ? playback.duration : 0,
      elapsed: playback.position,
      paused,
    },
  }).catch(() => {});
}
