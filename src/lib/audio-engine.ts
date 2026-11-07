import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchLikedSongs } from "@/lib/innertube/library";
import type { ShelfItem } from "@/lib/innertube/types";
import { getLikedIdsSet } from "@/components/shared/like-buttons";
import { toggleLiked } from "@/lib/like-actions";
import { fetchWatchQueueContinuation } from "@/lib/innertube/radio";
import { fetchVariedRadio } from "@/lib/innertube/radio-variety";
import { prefetchStream, saveTrackMeta, streamUrlFor } from "@/lib/stream";
import { AudioGraph, canSelectOutputDevice } from "@/lib/audio-graph";
import { analyzeTrack, peekAnalysis, planMix } from "@/lib/track-analysis";
import { consumeFadeInto } from "@/lib/fade-request";
import { usePlaybackStore, type QueueTrack } from "@/lib/store/playback";
import { eqGains, usePlaybackSettings } from "@/lib/store/playback-settings";
// Fork: Discord toggle lives in the dedicated discord store (not settings).
import { useDiscordStore, isDiscordConfigured } from "@/lib/store/discord";
import { resolveStreamId, useTrackSourceStore } from "@/lib/store/track-source";
import { pickThumbnail } from "@/components/shared/thumbnail";
import { IS_LINUX, IS_WINDOWS } from "@/lib/platform";
// Fork note: Discord/track-meta/playback-position/shuffle restores deferred
// to a follow-up (see next commit) to keep this port reviewable. Premium
// gate already removed above.

/**
 * AudioEngine binds the playback store to a singleton HTMLAudioElement and
 * drives the native media controls.
 *
 * On Windows that happens from Rust via souvlaki (SMTC; see
 * src-tauri/src/media.rs), and the webview's own media session stays disabled
 * because it belongs to the WebView2 child process and appears as an "Unknown
 * app" duplicate. Everywhere else the web session IS the OS session: macOS
 * feeds WKWebView's Now Playing (which always wins the media keys), and on
 * Linux the entry WebKitGTK publishes over MPRIS is the one desktop widgets
 * see — feeding it directly is also what keeps WebKit's bare "YTubic"
 * fallback shell from showing up as a second player. Without that, a bare
 * <audio> element leaves next/previous unhandled and the keys do nothing.
 * On KDE, Rust also registers a host-owned player that supersedes WebKit's
 * so the taskbar tooltip gets controls (src-tauri/src/mpris.rs).
 *
 * Two <audio> elements exist, one active and one standby. Crossfade
 * preloads the next track on the standby element a few seconds before the
 * end, then ramps the two against each other and swaps roles; the store
 * moves to the next track the moment the fade starts, so everything
 * downstream (SMTC, scrobbling, prefetch) sees an ordinary track change.
 * The equaliser, mono and normalisation live in an AudioGraph built on
 * first use (see src/lib/audio-graph.ts).
 *
 * Mount this hook once, near the root. It owns the <audio> elements' lifecycle.
 */

/** Start loading the next track this long before the crossfade begins. */
const CROSSFADE_PRELOAD_LEAD_SEC = 8;
/** Length of the ramp that hands playback to the other source on a
 *  Song ↔ Video switch: just long enough to avoid a click. */
const SOURCE_SWITCH_FADE_SEC = 0.12;
/** Fade ramp resolution. */
const CROSSFADE_TICK_MS = 40;

/** The next track, loading or loaded on the standby element. */
type PendingNext = {
  index: number;
  streamVideoId: string;
  el: HTMLAudioElement;
  src?: string;
};

/** The in-progress ramp between the outgoing and the incoming element. */
type Fade = {
  from: HTMLAudioElement;
  to: HTMLAudioElement;
  timer: number;
};

/** Perceived-loudness curve for the volume slider (see the volume effect). */
const elementVolume = (volume: number) => Math.max(0, Math.min(1, volume)) ** 3;

export function useAudioEngine() {
  // The element currently owning playback; `audioRef` keeps the name the
  // effects below were written against.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const standbyRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const pendingRef = useRef<PendingNext | null>(null);
  const fadeRef = useRef<Fade | null>(null);
  // Set when a crossfade moves the store to the next track: the resolve
  // effect then adopts the already-playing element instead of reloading.
  const adoptRef = useRef<{
    index: number;
    streamVideoId: string;
    src: string;
  } | null>(null);
  // "Resume where you left off": the position the store kept from the
  // last session, applied once to the matching track's first load.
  const resumeRef = useRef<{
    videoId: string;
    index: number;
    seconds: number;
  } | null>(null);
  // Guard against stale stream resolutions when the user skips mid-fetch.
  const resolveTokenRef = useRef(0);
  // The queue slot the resolve effect last handled, and the stream id that
  // is actually loaded in the active element. Together they tell a Song ↔
  // Video switch on the *same* track apart from a real track change, so the
  // switch can carry the playback position over instead of restarting.
  const lastTrackRef = useRef<{ videoId: string; index: number } | null>(null);
  const loadedStreamRef = useRef<string | null>(null);
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
  // Used for the liked-state of the current track: read for the taskbar
  // thumbnail toolbar's heart, and written when that heart is clicked.
  const queryClient = useQueryClient();

  // Ensure the pair of <audio> elements exists.
  useEffect(() => {
    if (audioRef.current) return;
    const make = () => {
      const el = new Audio();
      el.preload = "auto";
      // Streams come from our own axum server (streamUrlFor), which
      // answers with CORS headers, so the element can be read by the
      // WebAudio graph. Without this the graph would play silence.
      el.crossOrigin = "anonymous";
      return el;
    };
    const a = make();
    const b = make();
    audioRef.current = a;
    standbyRef.current = b;
    {
      const s = usePlaybackStore.getState();
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      if (
        t &&
        s.position > 0 &&
        usePlaybackSettings.getState().resumePlayback
      ) {
        resumeRef.current = {
          videoId: t.videoId,
          index: s.index,
          seconds: s.position,
        };
      }
    }
    return () => {
      for (const el of [a, b]) {
        el.pause();
        el.src = "";
      }
      audioRef.current = null;
      standbyRef.current = null;
    };
  }, []);

  /** Drop whatever the standby element was preloading. */
  const clearPending = () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    p.el.removeAttribute("src");
    p.el.load();
  };

  /** Stop a running fade: silence the outgoing element, restore the
   *  incoming one to full volume. */
  const cancelFade = () => {
    const f = fadeRef.current;
    if (!f) return;
    fadeRef.current = null;
    window.clearInterval(f.timer);
    f.from.pause();
    f.from.removeAttribute("src");
    f.from.load();
    f.to.volume = elementVolume(usePlaybackStore.getState().volume);
    graphRef.current?.resetBass();
  };

  /** Run the equal-power ramp between a fade's two elements; ends the
   *  fade (silencing the outgoing one) when it completes. */
  const beginRamp = (fade: Fade, seconds: number, onDone: () => void) => {
    const started = performance.now();
    const ms = seconds * 1000;
    fade.timer = window.setInterval(() => {
      const base = elementVolume(usePlaybackStore.getState().volume);
      const t = Math.min(1, (performance.now() - started) / ms);
      // Equal-power ramp: the sum of the two stays at a steady loudness.
      fade.from.volume = base * Math.cos((t * Math.PI) / 2);
      fade.to.volume = base * Math.sin((t * Math.PI) / 2);
      if (t >= 1) onDone();
    }, CROSSFADE_TICK_MS);
  };

  /** Build the WebAudio graph on first need and route both elements
   *  through it. One-way: elements cannot be detached again. */
  const ensureGraph = (): AudioGraph | null => {
    if (graphRef.current) return graphRef.current;
    if (typeof AudioContext === "undefined") return null;
    try {
      const g = new AudioGraph();
      graphRef.current = g;
      for (const el of [audioRef.current, standbyRef.current]) {
        if (el) g.attach(el);
      }
      return g;
    } catch (e) {
      if (import.meta.env.DEV) console.error("[audio] graph failed:", e);
      return null;
    }
  };

  // Wire element → store events. Both elements are listened to; events
  // from the one that isn't active belong to a crossfade preload (or the
  // tail of a track fading out) and are handled separately.
  useEffect(() => {
    const a = audioRef.current;
    const b = standbyRef.current;
    if (!a || !b) return;
    const store = usePlaybackStore.getState;
    const isActive = (e: Event) => e.currentTarget === audioRef.current;

    /**
     * Crossfade driver, run on every timeupdate of the active element.
     * Two thresholds: preload the next track on the standby element a
     * little ahead, then, once it has buffered, start the ramp.
     */
    const maybeCrossfade = (el: HTMLAudioElement) => {
      const ps = usePlaybackSettings.getState();
      const cf = ps.crossfadeSec;
      if (cf <= 0 || fadeRef.current) return;
      const s = store();
      const nextIndex = s.index + 1;
      // Only a plain step to the next queued track is crossfaded; repeat
      // wraps and single-track loops go through `ended` as before.
      if (!s.playing || s.repeat === "one" || nextIndex >= s.queue.length) {
        return;
      }
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const remaining = dur - el.currentTime;

      // Smart timing: once the outgoing track has been analysed, start the
      // ramp as its outro begins and end it where the audible content
      // ends. Until then (or if analysis fails) the fixed length applies.
      let mixStart = cf; // seconds before the end at which the ramp begins
      let mixSec = cf;
      const curSrc = el.currentSrc || el.src;
      if (ps.mixSmartTiming && curSrc) {
        const a = peekAnalysis(curSrc);
        if (a === undefined) void analyzeTrack(curSrc);
        else if (a) {
          const plan = planMix(a, dur, cf);
          mixStart = plan.startRemaining;
          mixSec = plan.seconds;
        }
      }

      const nextTrack = s.queue[nextIndex];
      const nextStreamId = resolveStreamId(
        nextTrack.videoId,
        useTrackSourceStore.getState().byVideoId,
      );

      const pending = pendingRef.current;
      if (
        pending &&
        (pending.index !== nextIndex || pending.streamVideoId !== nextStreamId)
      ) {
        clearPending();
      }

      if (
        !pendingRef.current &&
        remaining <= mixStart + CROSSFADE_PRELOAD_LEAD_SEC
      ) {
        const standby = standbyRef.current;
        // Fork note: upstream's Premium gate removed — this fork streams
        // without a Premium check (see docs "removes the Premium playback gate").
        if (!standby) {
          return;
        }
        const p: PendingNext = {
          index: nextIndex,
          streamVideoId: nextStreamId,
          el: standby,
        };
        pendingRef.current = p;
        streamUrlFor(nextStreamId)
          .then((src) => {
            if (pendingRef.current !== p) return;
            p.src = src;
            standby.src = src;
            standby.load();
            if (usePlaybackSettings.getState().mixSmartTiming) {
              void analyzeTrack(src);
            }
          })
          .catch(() => {
            if (pendingRef.current === p) pendingRef.current = null;
          });
        return;
      }

      const ready = pendingRef.current;
      if (
        ready?.src &&
        remaining <= mixStart &&
        ready.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        startCrossfade(el, ready, mixSec);
      }
    };

    const startCrossfade = (
      from: HTMLAudioElement,
      next: PendingNext,
      seconds: number,
    ) => {
      const to = next.el;
      pendingRef.current = null;
      to.muted = store().muted;
      to.volume = 0;
      // Swap roles first so the incoming element's `playing` counts as
      // the active one, then tell the store, whose track change the
      // resolve effect below recognises via adoptRef and leaves alone.
      audioRef.current = to;
      standbyRef.current = from;
      adoptRef.current = {
        index: next.index,
        streamVideoId: next.streamVideoId,
        src: next.src ?? "",
      };
      store().next();
      graphRef.current?.resume();
      const ps = usePlaybackSettings.getState();
      // Skip a silent intro on the incoming track, if it has been analysed.
      if (ps.mixSmartTiming && next.src) {
        const a = peekAnalysis(next.src);
        if (a && a.introStart >= 0.3) {
          try {
            to.currentTime = a.introStart;
          } catch {
            /* not seekable yet: start from the top */
          }
        }
      }
      if (ps.mixBassSwap) graphRef.current?.swapBass(from, to, seconds);
      void to.play().catch(() => {});

      const fade: Fade = { from, to, timer: 0 };
      fadeRef.current = fade;
      beginRamp(fade, seconds, cancelFade);
    };

    const onTimeUpdate = (e: Event) => {
      if (!isActive(e)) return;
      const el = e.currentTarget as HTMLAudioElement;
      store().setPosition(el.currentTime);
      maybeCrossfade(el);
    };
    const onDurationChange = (e: Event) => {
      if (!isActive(e)) return;
      const el = e.currentTarget as HTMLAudioElement;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        store().setDuration(el.duration);
      }
    };
    const onEnded = (e: Event) => {
      // The outgoing half of a crossfade ends on its own; the store has
      // already moved on.
      if (!isActive(e)) return;
      store().next();
    };
    const onError = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      if (!isActive(e)) {
        // A preload that failed just means no crossfade for this
        // transition: the track is resolved afresh when it's due.
        if (pendingRef.current?.el === el) {
          pendingRef.current = null;
          if (import.meta.env.DEV) {
            console.warn(
              "[audio] crossfade preload failed:",
              el.error?.message,
            );
          }
        }
        return;
      }
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
    const onPlaying = (e: Event) => {
      if (!isActive(e)) return;
      consecutiveErrorsRef.current = 0;
      // Track played successfully — allow a fresh auto-retry if it later
      // fails again (e.g. a mid-stream drop on a much later replay).
      retriedTrackRef.current = null;
      store().setStatus("ready");
    };
    const onWaiting = () => {
      // buffering — keep status as ready; don't flip to loading on every gap.
    };

    for (const el of [a, b]) {
      el.addEventListener("timeupdate", onTimeUpdate);
      el.addEventListener("durationchange", onDurationChange);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);
      el.addEventListener("playing", onPlaying);
      el.addEventListener("waiting", onWaiting);
    }
    return () => {
      for (const el of [a, b]) {
        el.removeEventListener("timeupdate", onTimeUpdate);
        el.removeEventListener("durationchange", onDurationChange);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("waiting", onWaiting);
      }
    };
  }, []);

  // React to current-track changes → resolve stream → set src.
  const { videoId, track, index } = usePlaybackStore(
    useShallow((s) => {
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      return { videoId: t?.videoId, track: t, index: s.index };
    }),
  );

  // Substitute the streaming videoId via the user's per-track source
  // preference (Song ↔ Music Video). Subscribing here means the effect
  // below re-runs and re-resolves the stream when the user toggles the
  // source on the currently playing track.
  const streamVideoId = useTrackSourceStore((s) =>
    videoId ? resolveStreamId(videoId, s.byVideoId) : undefined,
  );

  // Fork note: upstream's Premium subscription removed — no gate in this fork.

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // Same queue slot as last time, but a different stream id than the one
    // loaded: the user flipped Song ↔ Video on the playing track.
    const prevTrack = lastTrackRef.current;
    lastTrackRef.current = videoId !== undefined ? { videoId, index } : null;
    const loadedId = loadedStreamRef.current;
    const isSourceSwitch =
      !!prevTrack &&
      videoId !== undefined &&
      prevTrack.videoId === videoId &&
      prevTrack.index === index &&
      !!streamVideoId &&
      !!loadedId &&
      loadedId !== streamVideoId;
    // A crossfade already has this track playing on the (now active)
    // element: adopt it rather than reloading. The outgoing element keeps
    // fading in the background.
    const adopt = adoptRef.current;
    adoptRef.current = null;
    if (
      adopt &&
      streamVideoId &&
      adopt.index === index &&
      adopt.streamVideoId === streamVideoId
    ) {
      loadedStreamRef.current = streamVideoId;
      const st = usePlaybackStore.getState();
      st.setStreamUrl(adopt.src);
      st.setStatus("ready");
      if (Number.isFinite(el.duration) && el.duration > 0) {
        st.setDuration(el.duration);
      }
      void saveTrackMeta(
        streamVideoId,
        st.index >= 0 ? st.queue[st.index] : undefined,
      );
      return;
    }
    // "Play now with crossfade" (track menu): another track is playing and
    // the user asked to fade straight into the new one. The new track loads
    // on the standby element; the roles swap immediately (so the outgoing
    // element's events stop driving the store), and the ramp starts once
    // the newcomer is actually audible. Cancelling (skip, pause) goes
    // through the ordinary cancelFade, which silences the outgoing element.
    const fadeSec = usePlaybackSettings.getState().crossfadeSec;
    if (
      consumeFadeInto() &&
      streamVideoId &&
      fadeSec > 0 &&
      !el.paused &&
      el.currentSrc &&
      standbyRef.current
    ) {
      cancelFade();
      clearPending();
      const from = el;
      const to = standbyRef.current;
      const st = usePlaybackStore.getState();
      const token = ++resolveTokenRef.current;
      audioRef.current = to;
      standbyRef.current = from;
      loadedStreamRef.current = streamVideoId;
      to.muted = st.muted;
      to.volume = 0;
      st.setStatus("loading");
      void saveTrackMeta(
        streamVideoId,
        st.index >= 0 ? st.queue[st.index] : undefined,
      );
      const fade: Fade = { from, to, timer: 0 };
      fadeRef.current = fade;
      streamUrlFor(streamVideoId)
        .then((src) => {
          if (token !== resolveTokenRef.current) return;
          to.src = src;
          usePlaybackStore.getState().setStreamUrl(src);
          to.load();
          graphRef.current?.resume();
          to.addEventListener(
            "playing",
            () => {
              if (token !== resolveTokenRef.current) return;
              if (fadeRef.current !== fade) return;
              if (usePlaybackSettings.getState().mixBassSwap) {
                graphRef.current?.swapBass(from, to, fadeSec);
              }
              beginRamp(fade, fadeSec, cancelFade);
            },
            { once: true },
          );
          void to.play().catch((e) => {
            if (e?.name === "AbortError") return;
            usePlaybackStore
              .getState()
              .setStatus("error", e?.message ?? String(e));
          });
        })
        .catch((e: Error) => {
          if (token !== resolveTokenRef.current) return;
          cancelFade();
          usePlaybackStore.getState().setStatus("error", e.message);
          usePlaybackStore.getState().setPlaying(false);
        });
      return;
    }
    // Song ↔ Video on the track that is playing right now: keep the old
    // source audible while the new one loads on the standby element, seek
    // it to the same position, start it silently, line it up with the old
    // one, and only then swap with a very short ramp. There is never a
    // silent gap, and the position carries over.
    if (
      isSourceSwitch &&
      streamVideoId &&
      standbyRef.current &&
      !el.paused &&
      el.currentSrc &&
      !el.error &&
      el.readyState >= 2
    ) {
      cancelFade();
      clearPending();
      const from = el;
      const to = standbyRef.current;
      const newId = streamVideoId;
      const token = ++resolveTokenRef.current;
      to.muted = from.muted;
      to.volume = 0;
      const fail = () => {
        if (token !== resolveTokenRef.current) return;
        to.removeAttribute("src");
        to.load();
        toast.error(
          "Couldn't load that version, still playing the current one",
        );
      };
      streamUrlFor(newId)
        .then((src) => {
          if (token !== resolveTokenRef.current) return;
          let swapped = false;
          const swap = () => {
            if (swapped || token !== resolveTokenRef.current) return;
            swapped = true;
            const st = usePlaybackStore.getState();
            audioRef.current = to;
            standbyRef.current = from;
            loadedStreamRef.current = newId;
            st.setStreamUrl(src);
            if (Number.isFinite(to.duration) && to.duration > 0) {
              st.setDuration(to.duration);
            }
            graphRef.current?.resume();
            if (st.playing) {
              const fade: Fade = { from, to, timer: 0 };
              fadeRef.current = fade;
              beginRamp(fade, SOURCE_SWITCH_FADE_SEC, cancelFade);
            } else {
              // Paused while it loaded: swap in place, no ramp.
              to.pause();
              to.volume = elementVolume(st.volume);
              from.pause();
              from.removeAttribute("src");
              from.load();
            }
          };
          to.addEventListener("error", fail, { once: true });
          to.addEventListener(
            "loadedmetadata",
            () => {
              if (token !== resolveTokenRef.current) return;
              const limit = Number.isFinite(to.duration)
                ? Math.max(0, to.duration - 0.5)
                : Infinity;
              to.currentTime = Math.min(from.currentTime, limit);
            },
            { once: true },
          );
          to.addEventListener(
            "seeked",
            () => {
              if (token !== resolveTokenRef.current) return;
              void to.play().catch(fail);
            },
            { once: true },
          );
          to.addEventListener(
            "playing",
            () => {
              if (token !== resolveTokenRef.current) return;
              // `from` kept playing while this loaded: close the gap.
              const target = from.currentTime + 0.05;
              if (Math.abs(to.currentTime - target) > 0.08) {
                to.addEventListener("seeked", swap, { once: true });
                window.setTimeout(swap, 1500);
                to.currentTime = target;
              } else {
                swap();
              }
            },
            { once: true },
          );
          to.src = src;
          to.load();
        })
        .catch(fail);
      return;
    }
    // A switch that cannot be done seamlessly (paused, or the element is
    // not playable): fall through to a normal load, but keep the position.
    if (isSourceSwitch) {
      const pos = el.currentSrc
        ? el.currentTime
        : usePlaybackStore.getState().position;
      if (pos > 0.5 && videoId !== undefined) {
        resumeRef.current = { videoId, index, seconds: pos };
      }
    }
    // Any other track change ends a fade and discards the preload.
    cancelFade();
    clearPending();
    // Stop the previous track immediately. Without this the old src keeps
    // playing through the streamUrlFor() round-trip (~50–500 ms), so the
    // user hears the tail of track A bleed into the start of track B.
    el.pause();
    loadedStreamRef.current = null;
    if (!streamVideoId) {
      el.removeAttribute("src");
      el.load();
      usePlaybackStore.getState().setStreamUrl(undefined);
      return;
    }
    // Fork note: upstream's Premium gate removed — signed-out / Free
    // accounts stream like Premium ones in this fork.
    // Drop the previous track's src immediately. Otherwise a paused→playing
    // transition committed together with the track change (playNow/goTo set
    // playing: true) makes the [playing] effect below re-play the OLD src
    // for the duration of the streamUrlFor() round-trip.
    el.removeAttribute("src");

    const token = ++resolveTokenRef.current;
    usePlaybackStore.getState().setStatus("loading");

    // Persist this track's title/artist beside its cache file so the
    // Storage tab can name it without depending on the library walk.
    // Read from the store imperatively (like the rest of this effect) so
    // the track object doesn't have to join the dependency array.
    {
      const st = usePlaybackStore.getState();
      void saveTrackMeta(
        streamVideoId,
        st.index >= 0 ? st.queue[st.index] : undefined,
      );
    }

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
        loadedStreamRef.current = streamVideoId;
        usePlaybackStore.getState().setStreamUrl(src);
        el.load();
        // First load of the track the last session ended on: pick up
        // where it left off once the element knows its duration.
        const resume = resumeRef.current;
        resumeRef.current = null;
        if (resume && resume.videoId === videoId && resume.index === index) {
          el.addEventListener(
            "loadedmetadata",
            () => {
              if (token !== resolveTokenRef.current) return;
              const dur = el.duration;
              if (Number.isFinite(dur) && resume.seconds < dur - 1) {
                el.currentTime = resume.seconds;
              }
            },
            { once: true },
          );
        }
        if (usePlaybackStore.getState().playing) {
          graphRef.current?.resume();
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
      graphRef.current?.resume();
      void el.play().catch((e) => {
        if (e?.name === "AbortError") return;
        usePlaybackStore.getState().setStatus("error", e?.message ?? String(e));
      });
    } else {
      // Pausing mid-fade cuts the outgoing track rather than leaving it
      // to keep playing on its own.
      cancelFade();
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
    // During a crossfade the ramp owns both elements' volumes and reads
    // the store's value on every tick, so only mute is applied here.
    if (!fadeRef.current) el.volume = elementVolume(volume);
    el.muted = muted;
    const standby = standbyRef.current;
    if (standby) standby.muted = muted;
  }, [volume, muted]);

  // Equaliser, mono and normalisation follow the Playback settings. The
  // graph is built the first time any of them is switched on (or an output
  // device is chosen) and stays for the session; while all are off it is
  // never built, so a plain <audio> path remains the default.
  const {
    eqEnabled,
    eqPreset,
    eqCustomGains,
    monoAudio,
    normalizeVolume,
    crossfadeSec,
    mixBassSwap,
  } = usePlaybackSettings(
    useShallow((s) => ({
      crossfadeSec: s.crossfadeSec,
      mixBassSwap: s.mixBassSwap,
      eqEnabled: s.eqEnabled,
      eqPreset: s.eqPreset,
      eqCustomGains: s.eqCustomGains,
      monoAudio: s.monoAudio,
      normalizeVolume: s.normalizeVolume,
    })),
  );
  const outputDeviceId = usePlaybackSettings((s) => s.outputDeviceId);
  const wantsGraph =
    eqEnabled ||
    monoAudio ||
    normalizeVolume ||
    outputDeviceId !== "" ||
    (crossfadeSec > 0 && mixBassSwap);
  useEffect(() => {
    const g = wantsGraph ? ensureGraph() : graphRef.current;
    if (!g) return;
    g.setEq(eqEnabled, eqGains({ eqPreset, eqCustomGains }));
    g.setMono(monoAudio);
    g.setNormalize(normalizeVolume);
    if (usePlaybackStore.getState().playing) g.resume();
  }, [
    wantsGraph,
    eqEnabled,
    eqPreset,
    eqCustomGains,
    monoAudio,
    normalizeVolume,
  ]);

  // Output device. Once the graph exists the context is what renders, so
  // the sink is set there; before that, on the elements themselves. A
  // device that has gone away rejects and playback stays on the default.
  useEffect(() => {
    if (!canSelectOutputDevice()) return;
    const g = graphRef.current;
    const apply = g
      ? g.setSinkId(outputDeviceId)
      : Promise.all(
          [audioRef.current, standbyRef.current].map((el) =>
            el ? el.setSinkId(outputDeviceId) : Promise.resolve(),
          ),
        );
    void apply.catch((e) => {
      if (import.meta.env.DEV) console.warn("[audio] setSinkId failed:", e);
    });
    // `wantsGraph` so the sink is re-applied on the context the moment the
    // graph takes over rendering from the elements.
  }, [outputDeviceId, wantsGraph]);

  // Handle seek requests.
  const pendingSeek = usePlaybackStore((s) => s.pendingSeek);
  useEffect(() => {
    const el = audioRef.current;
    if (!el || pendingSeek === undefined) return;
    try {
      el.currentTime = pendingSeek;
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
      graphRef.current?.resume();
      void el.play().catch((e) => {
        if (e?.name === "AbortError") return;
        usePlaybackStore.getState().setStatus("error", e?.message ?? String(e));
      });
    }
  }, [pendingSeek]);

  // OS media controls are driven from Rust via souvlaki on Windows only;
  // everywhere else navigator.mediaSession IS the OS session (Now Playing
  // on macOS, WebKitGTK's MPRIS entry on Linux). Metadata / state is
  // pushed by the media_update effect lower down; on Windows the buttons
  // come back via the media-control listener. See src-tauri/src/media.rs.

  // Not Windows: the web session owns Now Playing / MPRIS (see the hook
  // comment), and the play/pause key already works because WebKit pauses
  // the element itself — but that also means it flips `el.paused` behind
  // the store's back, so the handlers below exist to keep the store
  // authoritative and to supply the next/previous/seek commands a bare
  // <audio> session simply doesn't have.
  useEffect(() => {
    if (IS_WINDOWS || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const store = usePlaybackStore.getState;
    ms.setActionHandler("play", () => store().setPlaying(true));
    ms.setActionHandler("pause", () => store().setPlaying(false));
    ms.setActionHandler("nexttrack", () => store().next());
    ms.setActionHandler("previoustrack", () => store().prev());
    ms.setActionHandler("seekto", (d) => {
      if (typeof d.seekTime === "number") store().seek(d.seekTime);
    });
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("seekto", null);
    };
  }, []);

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

  // System media-control / media-key button presses arrive from Rust as a
  // `media-control` event. Drive the store the same way the old
  // navigator.mediaSession action handlers did. `cancelled` guards against
  // StrictMode's mount→unmount→mount double-listen, like the tray listener.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void listen<{ action: string; position?: number }>("media-control", (e) => {
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
        // The three below only exist on the Windows taskbar thumbnail
        // toolbar (see src-tauri/src/thumbbar.rs); SMTC has no such buttons.
        case "shuffle":
          store.setShuffle(!store.shuffle);
          break;
        case "repeat":
          store.cycleRepeat();
          break;
        case "like": {
          const t = store.index >= 0 ? store.queue[store.index] : undefined;
          if (!t) break;
          // Read the liked state at click time rather than closing over it,
          // so this listener stays mounted for the session.
          const cached = queryClient.getQueryData<ShelfItem[]>(["liked-songs"]);
          void toggleLiked({
            queryClient,
            videoId: t.videoId,
            wasLiked: getLikedIdsSet(cached).has(t.videoId),
            track: t,
          }).catch((err) => toast.error(String(err)));
          break;
        }
      }
    }).then((un) => {
      if (cancelled) un();
      else dispose = un;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient]);

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
    // Label the prefetched file too — same reasoning as the play path.
    const st = usePlaybackStore.getState();
    void saveTrackMeta(
      nextStreamVideoId,
      st.index >= 0 && st.index + 1 < st.queue.length
        ? st.queue[st.index + 1]
        : undefined,
    );
  }, [status, nextStreamVideoId]);

  // Auto-extend the queue with radio tracks when we're near the end, so
  // playback continues past the explicit queue.
  const autoRadio = usePlaybackStore((s) => s.autoRadio);
  const { qLen, qIndex, seedVideoId, radioEpoch } = usePlaybackStore(
    useShallow((s) => ({
      qLen: s.queue.length,
      qIndex: s.index,
      seedVideoId: s.index >= 0 ? s.queue[s.index]?.videoId : undefined,
      radioEpoch: s.radioEpoch,
    })),
  );

  // Drain a pending server-side shuffle continuation: when playback nears
  // the tail of the queue, pull the next ~50 tracks of the permutation and
  // append them. Deduped against the queue — once the permutation is
  // exhausted YTM starts repeating tracks, which is the signal to stop.
  const queueContinuation = usePlaybackStore((s) => s.queueContinuation);
  const continuationFetchingRef = useRef(false);
  useEffect(() => {
    if (!queueContinuation) return;
    if (qIndex < 0 || qLen === 0) return;
    // Only fetch once the playhead is close to the tail, so a freshly
    // built 50-track queue doesn't immediately drain its whole source.
    if (qLen - 1 - qIndex > 5) return;
    if (continuationFetchingRef.current) return;
    continuationFetchingRef.current = true;
    const token = queueContinuation;
    fetchWatchQueueContinuation(token)
      .then((page) => {
        const s = usePlaybackStore.getState();
        // Stale guard: the queue was replaced while the fetch was in flight.
        if (s.queueContinuation !== token) return;
        const seen = new Set(s.queue.map((t) => t.videoId));
        const fresh = page.tracks.filter((t) => !seen.has(t.id));
        if (fresh.length) s.appendToQueue(fresh);
        s.setQueueContinuation(
          fresh.length > 0 ? page.continuationToken : undefined,
        );
      })
      .catch(() => {
        // Fail open: drop the token so auto-radio (if on) can take over at
        // the end of the queue instead of wedging on a broken continuation.
        const s = usePlaybackStore.getState();
        if (s.queueContinuation === token) s.setQueueContinuation(undefined);
      })
      .finally(() => {
        continuationFetchingRef.current = false;
      });
  }, [queueContinuation, qIndex, qLen]);

  const radioFetchedForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!autoRadio) return;
    // A pending shuffle continuation owns the tail; radio only takes over
    // once it's exhausted (the drain effect clears it).
    if (queueContinuation) return;
    if (qIndex < 0 || !seedVideoId) return;
    // Only fire when the current track is the last queued one.
    if (qIndex < qLen - 1) return;
    // One fetch per seed, unless the queue was cleared since: then the
    // same track is the tail again and gets a fresh batch.
    const seedKey = `${seedVideoId}#${radioEpoch}`;
    if (radioFetchedForRef.current === seedKey) return;
    radioFetchedForRef.current = seedKey;
    const queued = usePlaybackStore.getState().queue;
    fetchVariedRadio(seedVideoId, {
      exclude: queued.map((t) => t.videoId),
      alternateSeeds: queued.slice(-5, -1).map((t) => t.videoId),
    })
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
  }, [autoRadio, queueContinuation, qIndex, qLen, seedVideoId, radioEpoch]);

  // Push metadata + playback state to the OS media controls. Native backends
  // interpolate the scrubber between pushes while the state is
  // Playing, so we don't push on every timeupdate — just on track / play-state
  // / duration change, plus a light 2s refresh while playing to correct drift
  // and reflect seeks. Live values are read imperatively so this OS sync never
  // re-triggers the resolve / playback effects above.
  const duration = usePlaybackStore((s) => s.duration);
  const shuffle = usePlaybackStore((s) => s.shuffle);
  const repeat = usePlaybackStore((s) => s.repeat);
  // Subscribed but never fetched here: the liked list is loaded by whichever
  // heart button is on screen (`enabled: false` just reads the shared cache),
  // and this only needs to know whether the current track is in it so the
  // taskbar toolbar's heart can be filled.
  const likedSongs = useQuery({
    queryKey: ["liked-songs"],
    queryFn: () => fetchLikedSongs(),
    enabled: false,
    staleTime: 60 * 60 * 1000,
    retry: false,
  }).data;
  const liked = track ? getLikedIdsSet(likedSongs).has(track.videoId) : false;
  // Signature of the metadata last handed to navigator.mediaSession. Re-setting
  // `ms.metadata` makes WebKit re-fetch the artwork URL, so the 2s position
  // refresh must not rebuild it — mirrors the LAST_META guard in media.rs.
  const lastWebMetaRef = useRef<string | null>(null);
  useEffect(() => {
    // Non-Windows: same cadence, but written to the web session the OS
    // actually listens to (see the hook comment) rather than round-tripped
    // through souvlaki. On Linux this is what turns WebKitGTK's bare
    // fallback shell into the real player instead of a ghost next to it.
    const pushWeb = () => {
      const ms = navigator.mediaSession;
      const s = usePlaybackStore.getState();
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      if (!t) {
        lastWebMetaRef.current = null;
        ms.metadata = null;
        ms.playbackState = "none";
        return;
      }
      const artist = buildArtistLabel(t);
      const album = t.album ?? "";
      const cover = pickThumbnail(t.thumbnails, 512) ?? "";
      const sig = `${t.title}${artist}${album}${cover}`;
      if (lastWebMetaRef.current !== sig) {
        lastWebMetaRef.current = sig;
        ms.metadata = new MediaMetadata({
          title: t.title,
          artist,
          album,
          artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
        });
      }
      ms.playbackState = s.playing ? "playing" : "paused";
      const dur = Number.isFinite(s.duration) ? s.duration : 0;
      // setPositionState rejects a position past the duration, and a 0/absent
      // duration outright — both happen briefly while a track is resolving.
      if (dur > 0) {
        ms.setPositionState({
          duration: dur,
          position: Math.min(Math.max(s.position, 0), dur),
          playbackRate: 1,
        });
      }
    };
    const push = () => {
      // Windows alone goes through Rust souvlaki; everywhere else the
      // web session is the player the desktop sees. Linux additionally feeds
      // the host-owned MPRIS player (KDE taskbar tooltip, see mpris.rs) via
      // the same command; Rust ignores it off KDE.
      if (!IS_WINDOWS && "mediaSession" in navigator) {
        pushWeb();
        if (!IS_LINUX) return;
      }
      const s = usePlaybackStore.getState();
      const t = s.index >= 0 ? s.queue[s.index] : undefined;
      if (!t) {
        void invoke("media_clear").catch(() => {});
        return;
      }
      void invoke("media_update", {
        now: {
          title: t.title,
          artist: buildArtistLabel(t),
          album: t.album ?? "",
          thumbnail: pickThumbnail(t.thumbnails, 512) ?? "",
          duration: Number.isFinite(s.duration) ? s.duration : 0,
          elapsed: s.position,
          paused: !s.playing,
          shuffle: s.shuffle,
          repeat: s.repeat,
          liked,
        },
      }).catch(() => {});
    };
    push();
    if (!playing) return;
    const id = window.setInterval(push, 2000);
    return () => window.clearInterval(id);
  }, [track, playing, duration, shuffle, repeat, liked]);

  // Discord Rich Presence mirrors the same metadata, but pushed only on
  // track / play-state / duration change — never the 2s position refresh
  // above. Discord rate-limits activity updates, and it derives its own
  // progress bar from the start/end timestamps, so one push animates the bar
  // for the whole song. Pausing hands the worker `paused: true`, which takes
  // the card down entirely: a Listening activity has no paused look, so
  // anything left up keeps claiming the user is listening.
  //
  // The worker + (re)connect lifecycle live in src-tauri/src/discord.rs; the
  // on/off toggle is mirrored separately by useDiscordPresenceSync, which
  // also clears the activity when disabled.
  // Fork: use the dedicated Discord store (with hideWhenPaused/onlySongs
  // filters restored in a follow-up; for now just gate on configured).
  const discordStore = useDiscordStore();
  const discordRp = isDiscordConfigured(discordStore);
  useEffect(() => {
    if (!discordRp) return; // disabled → useDiscordPresenceSync cleared it
    const s = usePlaybackStore.getState();
    const t = s.index >= 0 ? s.queue[s.index] : undefined;
    if (!t) {
      void invoke("discord_clear").catch(() => {});
      return;
    }
    const dur = Number.isFinite(s.duration) ? s.duration : 0;
    // Timestamps (hence the progress bar) only while actually playing: Discord
    // can't freeze a bar, so paused sends none rather than a wrong one. Unix
    // milliseconds, per Discord's Activity spec.
    let startMs: number | null = null;
    let endMs: number | null = null;
    if (s.playing && dur > 0) {
      startMs = Math.round(Date.now() - s.position * 1000);
      endMs = Math.round(startMs + dur * 1000);
    }
    // `paused` rides along separately: a track still resolving its duration
    // has no timestamps either, and the worker must not read that as a pause.
    void invoke("discord_update", {
      title: t.title,
      artist: buildArtistLabel(t),
      album: t.album ?? "",
      imageUrl: pickThumbnail(t.thumbnails, 512) ?? "",
      startMs,
      endMs,
      paused: !s.playing,
    }).catch(() => {});
  }, [track, playing, duration, discordRp]);
}

function buildArtistLabel(track: QueueTrack): string {
  if (track.artists?.length) return track.artists.map((a) => a.name).join(", ");
  return track.subtitle ?? "";
}
