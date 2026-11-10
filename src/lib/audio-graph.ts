import { EQ_BANDS } from "@/lib/store/playback-settings";

/**
 * The WebAudio chain behind the player's <audio> elements:
 *
 *   element -> fader -> deck bass -> head -> 9 x BiquadFilter -> mono
 *     -> [compressor] -> destination
 *
 * Built lazily by the audio engine the first time the equaliser, mono,
 * normalisation or a non-default output device is switched on. An element
 * attached through `createMediaElementSource` can never be detached, so
 * when all of those are off again the engine closes the graph and moves
 * playback to a fresh pair of elements (see `close`). Every stage is
 * transparent while its setting is off.
 *
 * On Linux the context's output relies on the bundled GStreamer sink
 * (src-tauri/gst-plugin): with WebKitGTK's stock pulsesink it plays pure
 * silence on high-latency outputs such as Bluetooth headphones.
 *
 * The elements must load their stream with `crossOrigin="anonymous"` and
 * the stream server must answer with CORS headers (it does, through the
 * permissive `CorsLayer` on the axum router); a tainted element does not
 * throw here, it just yields silence.
 *
 * Once an element is attached its own `volume` and `muted` are left at 1
 * and off, and its fader carries the level instead (see `setVolume`).
 */

/** `setSinkId` is missing from the DOM lib on AudioContext. */
type SinkCapable = { setSinkId?: (id: string) => Promise<void> };

const dbToGain = (db: number) => 10 ** (db / 20);

/** How far the bass of a track is pulled down while it is not "on deck". */
const MIX_BASS_CUT_DB = -32;

/** One attached element: its level and its DJ-mix low shelf. */
type Deck = {
  fader: GainNode;
  bass: BiquadFilterNode;
  volume: number;
  muted: boolean;
};

export class AudioGraph {
  readonly ctx: AudioContext;
  private readonly head: GainNode;
  private readonly filters: BiquadFilterNode[];
  private readonly mono: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly tail: GainNode;
  private normalize = false;
  private readonly decks = new Map<HTMLMediaElement, Deck>();

  constructor() {
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;
    this.head = ctx.createGain();
    this.tail = ctx.createGain();

    // Outer bands are shelves so a bass or treble boost lifts everything
    // beyond the band rather than a single hump; the rest are peaks about
    // an octave wide, matching the one-octave spacing of the bands.
    this.filters = EQ_BANDS.map((hz, i) => {
      const f = ctx.createBiquadFilter();
      f.frequency.value = hz;
      if (i === 0) f.type = "lowshelf";
      else if (i === EQ_BANDS.length - 1) f.type = "highshelf";
      else {
        f.type = "peaking";
        f.Q.value = 1.2;
      }
      f.gain.value = 0;
      return f;
    });

    // Mono is a plain gain node forced to one channel: with an explicit
    // channel count of 1 the mixer folds L+R down on the way in, and the
    // destination spreads the single channel back to both speakers.
    this.mono = ctx.createGain();
    this.setMono(false);

    // Loudness levelling, approximated: a fairly firm compressor with
    // the automatic make-up gain WebAudio applies. Without per-track
    // loudness metadata this is what evens quiet and loud tracks out.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    let node: AudioNode = this.head;
    for (const f of this.filters) {
      node.connect(f);
      node = f;
    }
    node.connect(this.mono);
    this.mono.connect(this.tail);
    this.tail.connect(ctx.destination);
  }

  /**
   * Route an element through the graph. Idempotent per element. The
   * element's current volume and mute move onto its fader, and the
   * element itself is set to full volume, unmuted.
   */
  attach(el: HTMLMediaElement): void {
    if (this.decks.has(el)) return;
    const fader = this.ctx.createGain();
    const bass = this.ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 220;
    bass.gain.value = 0;
    const deck: Deck = { fader, bass, volume: el.volume, muted: el.muted };
    fader.gain.value = deck.muted ? 0 : deck.volume;
    this.ctx.createMediaElementSource(el).connect(fader);
    fader.connect(bass);
    bass.connect(this.head);
    this.decks.set(el, deck);
    el.volume = 1;
    el.muted = false;
  }

  /**
   * An attached element's level, on the same 0..1 scale as
   * `HTMLMediaElement.volume`. Returns false for an element the graph
   * does not own, which should then be set directly.
   *
   * The element's own volume can't be used once it is attached:
   * WebKitGTK taps the audio before the element's volume and mute are
   * applied, so they stop doing anything, while Chromium applies them
   * before the graph, so using both there would apply the level twice.
   */
  setVolume(el: HTMLMediaElement, volume: number): boolean {
    const deck = this.decks.get(el);
    if (!deck) return false;
    deck.volume = volume;
    this.applyLevel(deck);
    return true;
  }

  /** Mute counterpart of `setVolume`. */
  setMuted(el: HTMLMediaElement, muted: boolean): boolean {
    const deck = this.decks.get(el);
    if (!deck) return false;
    deck.muted = muted;
    this.applyLevel(deck);
    return true;
  }

  private applyLevel(deck: Deck): void {
    const t = this.ctx.currentTime;
    const g = deck.fader.gain;
    g.cancelScheduledValues(t);
    // A short glide so the 40 ms crossfade steps and mute don't click.
    g.setTargetAtTime(deck.muted ? 0 : deck.volume, t, 0.01);
  }

  /**
   * DJ-style bass swap across a crossfade of `seconds`: the outgoing
   * track's low end is pulled out first (around the 20-50 % mark), then
   * the incoming track's bass opens up (50-75 %), so the two basslines
   * never stack on top of each other. Scheduled on the audio clock.
   */
  swapBass(
    outgoing: HTMLMediaElement,
    incoming: HTMLMediaElement,
    seconds: number,
  ): void {
    const out = this.decks.get(outgoing)?.bass;
    const inn = this.decks.get(incoming)?.bass;
    if (!out || !inn) return;
    const t = this.ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(0, t);
    out.gain.setValueAtTime(0, t + seconds * 0.2);
    out.gain.linearRampToValueAtTime(MIX_BASS_CUT_DB, t + seconds * 0.5);
    inn.gain.cancelScheduledValues(t);
    inn.gain.setValueAtTime(MIX_BASS_CUT_DB, t);
    inn.gain.setValueAtTime(MIX_BASS_CUT_DB, t + seconds * 0.5);
    inn.gain.linearRampToValueAtTime(0, t + seconds * 0.75);
  }

  /** Restore full bass on every deck (mix finished or cancelled). */
  resetBass(): void {
    const t = this.ctx.currentTime;
    for (const { bass } of this.decks.values()) {
      bass.gain.cancelScheduledValues(t);
      bass.gain.setTargetAtTime(0, t, 0.03);
    }
  }

  /** Autoplay policy can leave the context suspended; call around play(). */
  resume(): void {
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Apply a curve, or flatten it when the equaliser is off. Boosts are
   * paid for with a matching pre-attenuation so a +10 dB band cannot push
   * a full-scale track into clipping.
   */
  setEq(enabled: boolean, gains: number[]): void {
    const t = this.ctx.currentTime;
    let maxBoost = 0;
    this.filters.forEach((f, i) => {
      const g = enabled ? (gains[i] ?? 0) : 0;
      maxBoost = Math.max(maxBoost, g);
      f.gain.setTargetAtTime(g, t, 0.02);
    });
    this.head.gain.setTargetAtTime(dbToGain(-maxBoost), t, 0.02);
  }

  setMono(on: boolean): void {
    this.mono.channelCount = on ? 1 : 2;
    this.mono.channelCountMode = on ? "explicit" : "max";
  }

  setNormalize(on: boolean): void {
    if (on === this.normalize) return;
    this.normalize = on;
    this.mono.disconnect();
    this.compressor.disconnect();
    if (on) {
      this.mono.connect(this.compressor);
      this.compressor.connect(this.tail);
    } else {
      this.mono.connect(this.tail);
    }
  }

  /** Stop rendering for good. The attached elements stay tied to this
   *  context and go silent with it, so they must not be used again. */
  close(): Promise<void> {
    this.decks.clear();
    return this.ctx.close().catch(() => {});
  }

  /** Move the whole context to an output device; "" is the default. */
  setSinkId(deviceId: string): Promise<void> {
    const ctx = this.ctx as unknown as SinkCapable;
    if (!ctx.setSinkId) return Promise.resolve();
    return ctx.setSinkId(deviceId);
  }
}

/** Whether this webview can pick an output device at all. */
export function canSelectOutputDevice(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}
