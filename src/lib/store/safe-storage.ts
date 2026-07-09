import type { StateStorage } from "zustand/middleware";

/**
 * localStorage wrapper for zustand's `persist` middleware that never
 * throws. `setItem` failures (quota exceeded, storage disabled) are easy
 * to hit on WebKitGTK, whose storage quota is tight — an unguarded write
 * from a store action called inside a `useEffect` (e.g. on every track
 * change) propagates straight to the nearest React error boundary and
 * blanks the whole app. Swallow it instead: losing one write is
 * harmless, crashing the UI mid-playback is not.
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      console.warn(`[safe-storage] failed to persist "${name}":`, e);
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};
