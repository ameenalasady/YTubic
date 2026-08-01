import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { type PremiumStatus } from "@/lib/innertube/account";
import { authLoggedInQuery, premiumStatusQuery } from "@/lib/store/auth-queries";

type State = {
  /**
   * Last known Premium status from auto-detection. `null` while we
   * haven't checked yet *or* when the user is not signed in.
   */
  status: PremiumStatus;
  setStatus: (status: PremiumStatus) => void;
};

/**
 * Premium-status state shared across the app. Purely informational in
 * this fork — playback is never gated on it; the only consumer is the
 * sidebar account menu's Premium/Free tier badge.
 *
 * The actual fetching/refresh is owned by the `usePremiumStatusSync`
 * hook mounted in AppShell. Nothing is persisted: `status` is
 * rederived on every launch so a Premium → Free downgrade outside the
 * app takes effect on the next start.
 */
export const usePremiumStore = create<State>()((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));

/**
 * Mount once near the app root (AppShell). Watches the login state
 * and, when authenticated, fetches Premium status from YT Music, then
 * mirrors it into the Zustand store. Signed-out users get `null`
 * immediately so stream URLs flip to ephemeral mode without waiting on
 * a network round-trip.
 */
export function usePremiumStatusSync(): void {
  const loggedIn = useQuery(authLoggedInQuery);
  const premium = useQuery(premiumStatusQuery(loggedIn.data === true));

  useEffect(() => {
    if (loggedIn.data === false) {
      usePremiumStore.setState({ status: null });
      return;
    }
    if (premium.data === undefined) return;
    usePremiumStore.getState().setStatus(premium.data);
  }, [loggedIn.data, premium.data]);
}
