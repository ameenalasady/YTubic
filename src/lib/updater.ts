import { useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

const TOAST_ID = "app-update";

// One update flow at a time: a second "Check for updates" click while a
// download is running must not start a parallel downloadAndInstall.
let busy = false;

/**
 * Check GitHub Releases for a newer version and walk the user through
 * install + restart via toasts.
 *
 * `silent` is the startup path: no feedback when already up to date or
 * when the check fails (offline, rate-limit) — the user didn't ask, so
 * we don't nag. The manual menu path reports every outcome.
 */
export async function checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
  // The updater only works in packaged builds; in `tauri dev` the
  // current version is a moving target and there's nothing to install.
  if (import.meta.env.DEV) {
    if (!silent) toast.info("Updates are only available in release builds.");
    return;
  }
  if (busy) return;
  busy = true;
  try {
    let update: Update | null;
    try {
      update = await check();
    } catch (e) {
      if (!silent) {
        toast.error("Couldn't check for updates", {
          id: TOAST_ID,
          description: String(e),
        });
      }
      return;
    }

    if (!update) {
      if (!silent) toast.success("You're on the latest version.", { id: TOAST_ID });
      return;
    }

    // Found one. Both paths (silent and manual) surface it — that's the
    // whole point of the startup check.
    const version = update.version;
    await new Promise<void>((resolve) => {
      toast.info(`Update ${version} is available`, {
        id: TOAST_ID,
        duration: Infinity,
        action: {
          label: "Install",
          onClick: () => {
            void installAndRestart(update);
            resolve();
          },
        },
        cancel: {
          label: "Later",
          onClick: () => resolve(),
        },
        onDismiss: () => resolve(),
      });
    });
  } finally {
    busy = false;
  }
}

async function installAndRestart(update: Update): Promise<void> {
  let total = 0;
  let received = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          toast.loading("Downloading update… 0%", {
            id: TOAST_ID,
            duration: Infinity,
          });
          break;
        case "Progress": {
          received += event.data.chunkLength;
          const pct = total > 0 ? Math.round((received / total) * 100) : null;
          toast.loading(
            pct === null ? "Downloading update…" : `Downloading update… ${pct}%`,
            { id: TOAST_ID, duration: Infinity },
          );
          break;
        }
        case "Finished":
          toast.loading("Installing…", { id: TOAST_ID, duration: Infinity });
          break;
      }
    });
  } catch (e) {
    toast.error("Update failed", { id: TOAST_ID, description: String(e) });
    return;
  }

  toast.success("Update installed", {
    id: TOAST_ID,
    duration: Infinity,
    description: "Restart to switch to the new version.",
    action: {
      label: "Restart now",
      onClick: () => {
        void relaunch();
      },
    },
    cancel: { label: "Later", onClick: () => {} },
  });
}

/**
 * Mount once in AppShell: quiet update check shortly after launch.
 * Delayed a few seconds so it never competes with first paint, feed
 * loading, or the yt-dlp bootstrap for attention/bandwidth.
 */
export function useUpdateStartupCheck(): void {
  useEffect(() => {
    const t = window.setTimeout(() => {
      void checkForUpdates({ silent: true });
    }, 5000);
    return () => window.clearTimeout(t);
  }, []);
}
