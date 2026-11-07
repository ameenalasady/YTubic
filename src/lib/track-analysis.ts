/**
 * Loudness-envelope analysis of a track, used by the "smart timing" mix:
 * where the audible content starts and ends, and where the outro begins,
 * so a crossfade can start as the song winds down instead of at a fixed
 * number of seconds before the file ends.
 *
 * The stream server downloads each track to disk and serves it from there,
 * so fetching the stream URL here is a local read, not extra network use.
 * The file is decoded at 8 kHz (a cheap, throwaway resample: ~15 MB for a
 * four-minute track, freed right after) and reduced to 0.25 s RMS windows.
 */

export type TrackAnalysis = {
  /** Seconds of leading silence to skip; 0 when there is none worth skipping. */
  introStart: number;
  /** Second at which the track settles into its quieter outro. */
  outroStart: number;
  /** Second at which the last audible content ends (trailing silence trimmed). */
  audibleEnd: number;
};

const WINDOW_SEC = 0.25;
const DECODE_RATE = 8000;
/** Silence floor, relative to the track's typical loudness (~ -34 dB). */
const SILENCE_REL = 0.02;
/** Below this fraction of typical loudness a passage counts as "outro". */
const OUTRO_REL = 0.6;
/** Do not skip more leading silence than this: a long quiet intro is music. */
const MAX_INTRO_SKIP_SEC = 12;
/** Skip analysis for huge files (long mixes / podcasts). */
const MAX_BYTES = 40 * 1024 * 1024;
const CACHE_LIMIT = 16;

/** undefined = not analysed yet, null = analysis failed or not applicable. */
const cache = new Map<string, TrackAnalysis | null>();
const inflight = new Map<string, Promise<TrackAnalysis | null>>();

const keyOf = (src: string) => {
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
};

export function peekAnalysis(src: string): TrackAnalysis | null | undefined {
  return cache.get(keyOf(src));
}

export function analyzeTrack(src: string): Promise<TrackAnalysis | null> {
  const key = keyOf(src);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;

  const p = run(key)
    .catch(() => null)
    .then((result) => {
      cache.set(key, result);
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      inflight.delete(key);
      return result;
    });
  inflight.set(key, p);
  return p;
}

async function run(url: string): Promise<TrackAnalysis | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return null;

  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE);
  const audio = await ctx.decodeAudioData(bytes);

  const win = Math.max(1, Math.floor(DECODE_RATE * WINDOW_SEC));
  const count = Math.floor(audio.length / win);
  if (count < 16) return null; // under ~4 s: nothing to plan

  const rms = new Float32Array(count);
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    channels.push(audio.getChannelData(c));
  }
  for (let w = 0; w < count; w++) {
    let sum = 0;
    const from = w * win;
    for (const ch of channels) {
      for (let i = from; i < from + win; i++) sum += ch[i] * ch[i];
    }
    rms[w] = Math.sqrt(sum / (win * channels.length));
  }

  // Typical loudness: the median of the windows that are not digital silence.
  const live = Array.from(rms).filter((v) => v > 1e-4);
  if (live.length < 16) return null;
  live.sort((a, b) => a - b);
  const body = live[Math.floor(live.length / 2)];
  const floor = body * SILENCE_REL;

  let first = 0;
  while (first < count && rms[first] <= floor) first++;
  let last = count - 1;
  while (last > first && rms[last] <= floor) last--;
  if (last - first < 16) return null;

  const introStart = Math.max(0, first * WINDOW_SEC - 0.05);
  const audibleEnd = (last + 1) * WINDOW_SEC;

  // One-second moving average so a single quiet beat does not end the body.
  const span = Math.round(1 / WINDOW_SEC);
  const smooth = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - span + 1); k <= i; k++) {
      s += rms[k];
      n++;
    }
    smooth[i] = s / n;
  }

  // Walk back from the end while the level stays below the outro line,
  // but never into the first half of the track.
  const limit = Math.floor(count / 2);
  let j = last;
  while (j - 1 > limit && smooth[j - 1] < body * OUTRO_REL) j--;
  const outroStart = j * WINDOW_SEC;

  return {
    introStart: introStart <= MAX_INTRO_SKIP_SEC ? introStart : 0,
    outroStart: Math.min(outroStart, audibleEnd),
    audibleEnd,
  };
}

/**
 * When to start a crossfade and for how long, given the outgoing track's
 * analysis. `startRemaining` is in seconds before the file's end. The ramp
 * finishes where the audible content does, and begins no earlier than the
 * outro; a long quiet outro is capped at the requested crossfade length.
 */
export function planMix(
  a: TrackAnalysis,
  duration: number,
  crossfade: number,
): { startRemaining: number; seconds: number } {
  const end = Math.min(a.audibleEnd, duration);
  const minSec = Math.min(crossfade, 2);
  let seconds = Math.min(
    crossfade,
    end - Math.max(end - crossfade, a.outroStart),
  );
  if (!(seconds >= minSec)) seconds = minSec;
  const start = end - seconds;
  if (start < 0) return { startRemaining: crossfade, seconds: crossfade };
  return { startRemaining: duration - start, seconds };
}
