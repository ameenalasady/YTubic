/**
 * One-shot request: "the next track change should crossfade".
 *
 * The track menu's "Play now with crossfade" arms this right before it
 * commits the normal play action to the playback store. The audio engine
 * consumes it when it reacts to that track change and, instead of cutting
 * the current track, loads the new one on the standby element and ramps
 * between them using the crossfade length from Settings → Playback.
 *
 * The request expires quickly so that, if the commit changes nothing (same
 * track picked again), it cannot leak into a later, unrelated track change.
 */

const TTL_MS = 1500;
let armedAt = 0;

export function armFadeInto(): void {
  armedAt = performance.now();
}

export function consumeFadeInto(): boolean {
  const live = armedAt > 0 && performance.now() - armedAt < TTL_MS;
  armedAt = 0;
  return live;
}
