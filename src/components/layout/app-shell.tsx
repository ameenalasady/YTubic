import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { PlayerBar } from "@/components/layout/player-bar";
import { PlayerBarBottom } from "@/components/layout/player-bar-bottom";
import { FloatingPlayerSync } from "@/components/layout/floating-player-sync";
import { DragSnapOverlay } from "@/components/layout/drag-snap-overlay";
import { WindowResizeHandles } from "@/components/layout/window-resize-handles";
import { EntityPageHeader } from "@/components/layout/entity-page-header";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAudioEngine } from "@/lib/audio-engine";
import { useLastfmScrobbler } from "@/lib/lastfm/scrobbler";
import { useYtdlpSetup } from "@/lib/ytdlp";
import { useUpdateStartupCheck } from "@/lib/updater";
import { pickHighResThumbnail } from "@/components/shared/thumbnail";
import { usePlaybackStore, currentTrack } from "@/lib/store/playback";
import { useLayoutStore } from "@/lib/store/layout";
import { usePremiumStatusSync } from "@/lib/store/premium";
import {
  useAccountMetaBackfill,
  useAccountsChangedListener,
  useLoginSuccessListener,
} from "@/lib/store/accounts";
import { cn } from "@/lib/utils";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      // Space toggles playback — but only when focus is NOT on an
      // interactive control, so a button/link the user tabbed to still
      // activates on Space. (Tab is no longer blocked window-wide; that
      // previously killed all keyboard navigation, including in dialogs.)
      if (e.key === " " || e.code === "Space") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("button, a, [role='button'], [tabindex]")) return;
        e.preventDefault();
        usePlaybackStore.getState().toggle();
      }
    };
    // On window blur (e.g. Alt+Tab away) drop focus from whatever control
    // was last clicked, so returning to the app doesn't leave a "ghost"
    // focused button that Space/Enter would re-trigger.
    const onWindowBlur = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && !isEditableTarget(el)) el.blur?.();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);
}

export function AppShell({ children }: { children: ReactNode }) {
  useAudioEngine();
  useLastfmScrobbler();
  useYtdlpSetup();
  useUpdateStartupCheck();
  usePremiumStatusSync();
  useLoginSuccessListener();
  useAccountsChangedListener();
  useAccountMetaBackfill();
  useGlobalShortcuts();
  const mode = useLayoutStore((s) => s.mode);
  const setMode = useLayoutStore((s) => s.setMode);
  // The player UI is hidden whenever there's no active track —
  // covers the "Nothing playing" empty state at first launch and
  // after the queue is cleared. The mode itself stays the same; the
  // player just reappears in the chosen slot once a track is loaded.
  const hasTrack = usePlaybackStore((s) => s.index >= 0 && s.index < s.queue.length);
  // Set when we close the floating window programmatically (queue emptied)
  // so the player-window-closed handler doesn't mistake it for the user
  // clicking X and revert the persisted floating layout preference.
  const suppressRevertRef = useRef(false);

  // Remember the last route across launches. The webview always cold-boots
  // at "/", so on first mount we replace it with whatever page the user was
  // last on. Scroll-to-top vs. scroll-restore for in-session navigation is
  // handled by the router's scrollRestoration (see App.tsx), which keys the
  // shared <main class="app-scroll"> scroller by its data-scroll-restoration-id.
  const router = useRouter();
  const href = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    const saved = localStorage.getItem("ytm-last-route");
    if (saved && saved !== "/" && saved !== router.state.location.href) {
      router.history.replace(saved);
    }
    // Only on first mount — restoring later would fight the user's navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ytm-last-route", href);
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [href]);

  // Open / close the floating player window. We only spawn it when
  // there's actually something to show — at first launch with mode
  // persisted as "floating", an empty "Nothing playing" window is
  // wasted real estate. As soon as a track is queued, this effect
  // re-fires (because `hasTrack` flipped) and the window pops up.
  useEffect(() => {
    if (mode === "floating" && hasTrack) {
      void invoke("open_player_window").catch((e) => {
        console.error("[layout] open_player_window failed:", e);
      });
    } else {
      // Closing only because the queue emptied (mode is still "floating")
      // is a programmatic hide, not the user leaving floating mode — mark
      // it so the close handler doesn't revert the layout to "right".
      if (mode === "floating" && !hasTrack) suppressRevertRef.current = true;
      void invoke("close_player_window").catch(() => {
        /* no window — fine */
      });
    }
  }, [mode, hasTrack]);

  // When the user closes the floating window with its X button, revert
  // to the side-card layout. The Rust window-event handler emits
  // `player-window-closed` from the `on_window_event` for label "player".
  // The `cancelled` flag protects against React StrictMode's
  // mount/unmount/remount cycle leaking duplicate listeners.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void listen("player-window-closed", () => {
      // Skip the revert when WE closed the window programmatically (queue
      // emptied) rather than the user clicking X.
      if (suppressRevertRef.current) {
        suppressRevertRef.current = false;
        return;
      }
      // Only flip if we're still in floating mode — guard against
      // races where the user already switched the mode themselves
      // (which closed the window first, triggering this event).
      if (useLayoutStore.getState().mode === "floating") {
        setMode("right");
      }
    }).then((un) => {
      if (cancelled) un();
      else dispose = un;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [setMode]);

  // Cross-window navigation: links inside the floating player window
  // can't use the router (no router there), so they emit Tauri events
  // and we handle navigation here.
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    const disposers: (() => void)[] = [];
    const wire = <T,>(event: string, handler: (payload: T) => void) => {
      void listen<T>(event, (e) => handler(e.payload)).then((un) => {
        if (cancelled) un();
        else disposers.push(un);
      });
    };
    wire<{ id: string }>("nav:artist", ({ id }) =>
      navigate({ to: "/artist/$id", params: { id } }),
    );
    wire<{ id: string }>("nav:album", ({ id }) =>
      navigate({ to: "/album/$id", params: { id } }),
    );
    return () => {
      cancelled = true;
      for (const d of disposers) d();
    };
  }, [navigate]);

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={0}>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "13rem",
            "--sidebar-width-icon": "4rem",
          } as React.CSSProperties
        }
      >
        <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
          <BackgroundCover />
          {/* Custom title bar spans the full window width so the
              Windows-style min/max/close buttons land in the actual
              top-right corner, not behind the floating player. */}
          <TopBar />
          <div className="relative flex min-h-0 flex-1">
            <AppSidebar />
            {/* In `right` mode we reserve 23rem on the right for the
                floating player card — but only when a track is
                actually loaded; the empty state shouldn't carve out
                dead space. `bottom` and `floating` follow the same
                "hide when no track" rule. */}
            <div
              className={cn(
                "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col",
                mode === "right" && hasTrack && "pr-[23rem]",
              )}
            >
              {/* Route entity header (playlist / album / artist).
                  Lives ABOVE <main> in flex flow so that
                  (a) a transparent bar inherits the app-wide
                      <BackgroundCover> tint directly, and
                  (b) track rows inside <main> are clipped by <main>'s
                      overflow and never appear behind the bar. */}
              <EntityPageHeader />
              {/* Plain scroller — NOT Radix ScrollArea. Radix wraps the
                  content in `display: table; min-width: 100%` which grows
                  to intrinsic width and defeats any nested `overflow-x`
                  (our horizontal carousels would never clip). */}
              <main
                data-scroll-restoration-id="main-scroll"
                className="app-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
              >
                {children}
              </main>
              {mode === "bottom" && hasTrack && <PlayerBarBottom />}
            </div>
            {mode === "right" && hasTrack && <PlayerBar />}
            {mode === "floating" && hasTrack && <FloatingPlayerSync />}
          </div>
          <DragSnapOverlay />
          <WindowResizeHandles />
        </div>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}

/**
 * Stretched, heavily-blurred copy of the current track's cover. Sits
 * between the solid `bg-background` and the rest of the UI so the
 * window picks up a subtle tint of whatever is playing.
 *
 * Two layered <img>s crossfade between tracks: a new URL goes into
 * whichever slot is currently inactive, then we flip `active`, and
 * the CSS opacity transition fades the old slot out while the new
 * slot fades in.
 */
function BackgroundCover() {
  const track = usePlaybackStore(currentTrack);
  const url =
    track?.thumbnails && track.thumbnails.length > 0
      ? pickHighResThumbnail(track.thumbnails)
      : null;

  const [slotA, setSlotA] = useState<string | null>(null);
  const [slotB, setSlotB] = useState<string | null>(null);
  const [active, setActive] = useState<"A" | "B">("A");

  useEffect(() => {
    if (!url) return;
    const currentSlot = active === "A" ? slotA : slotB;
    if (url === currentSlot) return;
    if (active === "A") {
      setSlotB(url);
      setActive("B");
    } else {
      setSlotA(url);
      setActive("A");
    }
  }, [url, active, slotA, slotB]);

  const baseClass =
    "pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150 transition-opacity duration-700 ease-out";

  return (
    <>
      {slotA && (
        <img
          src={slotA}
          alt=""
          aria-hidden
          className={baseClass}
          style={{ opacity: active === "A" ? 0.3 : 0 }}
        />
      )}
      {slotB && (
        <img
          src={slotB}
          alt=""
          aria-hidden
          className={baseClass}
          style={{ opacity: active === "B" ? 0.3 : 0 }}
        />
      )}
      {(slotA || slotB) && (
        <div
          aria-hidden
          className="bg-cover-noise pointer-events-none absolute inset-0"
        />
      )}
    </>
  );
}
