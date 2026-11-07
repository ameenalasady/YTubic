import { useEffect, useRef, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { usePlaybackStore } from "@/lib/store/playback";
import { videoUrlFor } from "@/lib/stream";

/** Beyond this the picture is re-seeked; below it the rate is nudged. */
const HARD_SEEK_SEC = 0.6;
const SYNC_TICK_MS = 250;

/** When a quality cannot be loaded, the next one down is tried. */
const LOWER: Record<number, number | undefined> = { 1440: 1080, 1080: 720 };

type Slot = { url: string; q: number };
type Slots = [Slot | undefined, Slot | undefined];

/**
 * The muted picture for a track's video, kept locked to the audio.
 *
 * The audio element stays the clock: its position reaches the store a few
 * times a second, and this extrapolates it between updates. A large gap
 * (a seek, a stall) is fixed with a hard seek; a small one by speeding the
 * picture up or slowing it down by a few percent, which is invisible.
 *
 * Two <video> slots let the quality change without a blank screen: the new
 * quality loads in the hidden slot, is seeked to the current position, and
 * only then does the visible slot swap. If a quality cannot be loaded (it
 * does not exist for this video, or the download failed) the next one down
 * is tried: 1440p → 1080p → 720p, before giving up on the picture.
 */
export function ImmersiveVideo({
  videoId,
  quality,
  onFail,
}: {
  videoId: string;
  quality: number;
  onFail: (reason: string) => void;
}) {
  const refs = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [slots, setSlotsState] = useState<Slots>([undefined, undefined]);
  const slotsRef = useRef<Slots>([undefined, undefined]);
  const [active, setActive] = useState<0 | 1>(0);
  const activeRef = useRef<0 | 1>(0);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState<number | null>(null);
  const promotingRef = useRef(false);
  const playing = usePlaybackStore((s) => s.playing);

  const setSlots = (next: Slots) => {
    slotsRef.current = next;
    setSlotsState(next);
  };

  const make = async (q: number): Promise<Slot> => ({
    url: await videoUrlFor(videoId, q),
    q,
  });

  // Resolve the URL for the wanted quality; the first one fills the visible
  // slot, a later one (quality change) fills the hidden slot.
  useEffect(() => {
    let off = false;
    make(quality)
      .then((slot) => {
        if (off) return;
        const a = activeRef.current;
        const b = a === 0 ? 1 : 0;
        const cur = slotsRef.current;
        if (!cur[a]) {
          const next: Slots = [...cur];
          next[a] = slot;
          setSlots(next);
        } else if (cur[a]!.q !== quality && cur[b]?.q !== quality) {
          const next: Slots = [...cur];
          next[b] = slot;
          promotingRef.current = false;
          setSlots(next);
          setSwitching(quality);
        } else if (cur[a]!.q === quality) {
          setSwitching(null);
        }
      })
      .catch((e) => {
        if (!off && !slotsRef.current[activeRef.current]) {
          failRef.current(String(e));
        }
      });
    return () => {
      off = true;
    };
    // `make` only closes over videoId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, quality]);

  // Play / pause follow the store.
  useEffect(() => {
    const v = refs.current[active];
    if (!v || !ready) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, ready, active]);

  // Drift correction against the audio clock.
  useEffect(() => {
    if (!ready) return;
    let last = {
      pos: usePlaybackStore.getState().position,
      at: performance.now(),
    };
    const unsub = usePlaybackStore.subscribe((st, prev) => {
      if (st.position !== prev.position) {
        last = { pos: st.position, at: performance.now() };
      }
    });
    const id = window.setInterval(() => {
      const v = refs.current[activeRef.current];
      if (!v) return;
      const st = usePlaybackStore.getState();
      const expected = st.playing
        ? last.pos + (performance.now() - last.at) / 1000
        : last.pos;
      const drift = v.currentTime - expected;
      if (!st.playing) {
        if (Math.abs(drift) > 0.1) v.currentTime = expected;
        v.playbackRate = 1;
        return;
      }
      if (Math.abs(drift) > HARD_SEEK_SEC) {
        v.currentTime = expected;
        v.playbackRate = 1;
      } else if (Math.abs(drift) > 0.05) {
        v.playbackRate = 1 - Math.max(-0.08, Math.min(0.08, drift * 0.5));
      } else {
        v.playbackRate = 1;
      }
    }, SYNC_TICK_MS);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [ready]);

  const onCanPlay = (slot: 0 | 1) => {
    if (slot === activeRef.current) {
      setReady(true);
      return;
    }
    // The hidden slot has the new quality: line it up with the visible
    // one, then swap and retire the old file once the fade is done.
    if (promotingRef.current) return;
    const incoming = refs.current[slot];
    const current = refs.current[activeRef.current];
    if (!incoming || !current) return;
    promotingRef.current = true;
    incoming.addEventListener(
      "seeked",
      () => {
        if (usePlaybackStore.getState().playing) {
          void incoming.play().catch(() => {});
        }
        const old = activeRef.current;
        activeRef.current = slot;
        setActive(slot);
        setSwitching(null);
        promotingRef.current = false;
        window.setTimeout(() => {
          if (activeRef.current !== old) {
            const next: Slots = [...slotsRef.current];
            next[old] = undefined;
            setSlots(next);
          }
        }, 700);
      },
      { once: true },
    );
    incoming.currentTime = current.currentTime + 0.2;
  };

  const onError = (slot: 0 | 1) => {
    const cur = slotsRef.current[slot];
    if (!cur) return;
    const el = refs.current[slot];
    const reason = el?.error
      ? `code ${el.error.code}${el.error.message ? `: ${el.error.message}` : ""}`
      : "load error";
    const lower = LOWER[cur.q];
    const isActive = slot === activeRef.current;
    const activeQ = slotsRef.current[activeRef.current]?.q ?? 0;

    // Step down a quality, unless that would not beat what is already on
    // screen (a failed upgrade from the visible slot).
    if (lower !== undefined && (isActive || lower > activeQ)) {
      console.warn(`[video] ${cur.q}p failed (${reason}), trying ${lower}p`);
      void make(lower).then((next) => {
        const slots: Slots = [...slotsRef.current];
        if (!slots[slot] || slots[slot]!.q !== cur.q) return;
        slots[slot] = next;
        promotingRef.current = false;
        if (isActive) setReady(false);
        setSlots(slots);
        setSwitching(lower);
      });
      return;
    }

    if (isActive) {
      failRef.current(reason);
      return;
    }
    // An upgrade that could not be loaded: stay on the current picture.
    const next: Slots = [...slotsRef.current];
    next[slot] = undefined;
    setSlots(next);
    setSwitching(null);
    promotingRef.current = false;
    toast.error(`Couldn't load ${cur.q}p, staying on ${activeQ}p`);
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {([0, 1] as const).map((slot) =>
        slots[slot] ? (
          <video
            key={slot}
            ref={(el) => {
              refs.current[slot] = el;
            }}
            src={slots[slot]!.url}
            muted
            playsInline
            preload="auto"
            onCanPlay={() => onCanPlay(slot)}
            onError={() => onError(slot)}
            className="absolute size-full object-contain transition-opacity duration-500"
            style={{ opacity: slot === active && ready ? 1 : 0 }}
          />
        ) : null,
      )}
      {!ready || switching !== null ? (
        <div className="absolute bottom-[38%] flex items-center gap-2 rounded-[10px] bg-w080 px-3.5 py-1.5 text-[12px] font-medium text-(--fs-txt2) backdrop-blur-md">
          <IconLoader2 className="size-3.5 animate-spin" />
          {switching !== null ? `Loading ${switching}p…` : "Loading video…"}
        </div>
      ) : null}
    </div>
  );
}
