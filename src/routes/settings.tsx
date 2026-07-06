import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2Icon,
  UserRoundIcon,
  LogInIcon,
  LogOutIcon,
  Loader2Icon,
  DatabaseIcon,
  Trash2Icon,
  HeartIcon,
  ImageIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resetInnertube } from "@/lib/innertube/client";
import { fetchLikedSongs } from "@/lib/innertube/library";
import { clearPrefetchMemo } from "@/lib/stream";
import { removeAccount } from "@/lib/store/accounts";
import { useTrackMetaStore, type TrackMeta } from "@/lib/store/track-meta";
import { backfillTrackMeta } from "@/lib/track-meta-fetch";
import type { ShelfItem } from "@/lib/innertube/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [signingIn, setSigningIn] = useState(false);

  const loggedIn = useQuery({
    queryKey: ["auth-logged-in"],
    queryFn: () => invoke<boolean>("is_logged_in"),
    staleTime: 30_000,
  });

  useEffect(() => {
    // Settings owns the in-flight spinner + the toast feedback for
    // sign-in from this page. Query invalidation + InnerTube client
    // reset live in the global `useLoginSuccessListener` so they fire
    // regardless of where the sign-in was initiated (here or from the
    // sidebar dropdown).
    const unlistenSuccess = listen("login-success", () => {
      setSigningIn(false);
      toast.success("Signed in");
    });
    const unlistenCancel = listen("login-cancelled", () => {
      setSigningIn(false);
    });
    return () => {
      unlistenSuccess.then((fn) => fn());
      unlistenCancel.then((fn) => fn());
    };
  }, []);

  const signIn = async () => {
    setSigningIn(true);
    try {
      await invoke("start_login");
    } catch (e) {
      setSigningIn(false);
      toast.error(String(e));
    }
  };

  const logout = async () => {
    try {
      // Per-account sign out: only the currently active account is
      // removed. If the user has other accounts registered, Rust's
      // `remove_account` promotes the next one to active; otherwise we
      // end up signed out entirely. Either way `accounts-changed`
      // fires and the global listener handles the cache reset.
      const activeId = await invoke<string | null>("get_active_account_id");
      if (activeId) {
        await removeAccount(activeId);
      } else {
        // Defensive fallback — no active account but the button was
        // somehow clickable. Nuke everything to leave a clean state.
        await invoke("clear_cookies");
        resetInnertube();
      }
      toast.success("Signed out");
    } catch (e) {
      toast.error(`Logout failed: ${String(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-3">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                <UserRoundIcon className="size-5" />
                Account
              </CardTitle>
              <CardDescription>
                Sign in with your Google account to see your library, liked
                songs, and play Premium-quality streams. Cookies stay on
                this machine.
              </CardDescription>
            </div>
            {loggedIn.data ? (
              <Badge
                variant="secondary"
                className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2Icon className="size-3.5" />
                Signed in
              </Badge>
            ) : (
              <Badge variant="outline">Signed out</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loggedIn.data ? (
            <Button variant="outline" onClick={logout}>
              <LogOutIcon />
              Sign out
            </Button>
          ) : (
            <Button onClick={signIn} disabled={signingIn}>
              {signingIn ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LogInIcon />
              )}
              Sign in with Google
            </Button>
          )}
        </CardContent>
      </Card>

      <CacheCard loggedIn={!!loggedIn.data} />

      <CoverCacheCard />
    </div>
  );
}

function CoverCacheCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const stats = useQuery({
    queryKey: ["cover-cache-stats"],
    queryFn: () =>
      invoke<{ count: number; bytes: number }>("cover_cache_stats"),
    staleTime: 30_000,
  });

  const clear = async () => {
    if (!stats.data?.count) return;
    if (
      !confirm(
        `Delete ${stats.data.count} cached cover image${
          stats.data.count === 1 ? "" : "s"
        } (${formatBytes(stats.data.bytes)})?`,
      )
    )
      return;
    setBusy(true);
    try {
      const freed = await invoke<number>("clear_cover_cache");
      await qc.invalidateQueries({ queryKey: ["cover-cache-stats"] });
      toast.success(`Cover cache cleared — freed ${formatBytes(freed)}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const empty = !stats.data?.count;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-5" />
              Cover art cache
            </CardTitle>
            <CardDescription>
              Album covers (iTunes hi-res lookups and YouTube originals)
              are pinned to disk so they don't redownload on every play.
            </CardDescription>
          </div>
          <Badge variant="outline">
            {stats.isLoading
              ? "…"
              : `${stats.data?.count ?? 0} files · ${formatBytes(
                  stats.data?.bytes ?? 0,
                )}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={clear}
          disabled={busy || empty}
        >
          {busy ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <Trash2Icon />
          )}
          Clear cover cache
        </Button>
      </CardContent>
    </Card>
  );
}

type CacheEntry = {
  videoId: string;
  size: number;
  modifiedSecs: number;
};

type FilterMode = "all" | "liked" | "notLiked";
type SortMode = "newest" | "oldest" | "largest";

const GB = 1024 ** 3;

// Presets for the storage-limit picker. `0` = unlimited. Kept in sync
// with the Rust default (5 GiB) so a fresh install lands on a preset.
const CACHE_LIMIT_OPTIONS: { label: string; bytes: number }[] = [
  { label: "512 MB", bytes: 512 * 1024 * 1024 },
  { label: "1 GB", bytes: 1 * GB },
  { label: "2 GB", bytes: 2 * GB },
  { label: "5 GB", bytes: 5 * GB },
  { label: "10 GB", bytes: 10 * GB },
  { label: "25 GB", bytes: 25 * GB },
  { label: "50 GB", bytes: 50 * GB },
  { label: "Unlimited", bytes: 0 },
];

function CacheCard({ loggedIn }: { loggedIn: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const trackMeta = useTrackMetaStore((s) => s.byId);

  const cache = useQuery({
    queryKey: ["cache-list"],
    queryFn: () => invoke<CacheEntry[]>("list_cache"),
    // Disk state changes outside React's knowledge while streams download —
    // re-fetch every 5s so the list reflects new cache entries.
    refetchInterval: 5_000,
  });

  const limitQuery = useQuery({
    queryKey: ["cache-limit"],
    queryFn: () => invoke<number>("get_cache_limit"),
    staleTime: 60_000,
  });
  const limit = limitQuery.data ?? 0;

  const setLimit = async (bytes: number) => {
    try {
      await invoke("set_cache_limit", { bytes });
      await qc.invalidateQueries({ queryKey: ["cache-limit"] });
      // Lowering the cap may have evicted tracks — refresh the list too.
      await qc.invalidateQueries({ queryKey: ["cache-list"] });
      toast.success(
        bytes === 0
          ? "Storage limit removed"
          : `Storage limit set to ${formatBytes(bytes)}`,
      );
    } catch (e) {
      toast.error(String(e));
    }
  };

  const liked = useQuery({
    queryKey: ["liked-songs"],
    queryFn: () => fetchLikedSongs(),
    enabled: loggedIn,
    staleTime: 60_000,
    retry: false,
  });

  const likedMeta = useMemo(() => {
    const m = new Map<string, ShelfItem>();
    for (const t of liked.data ?? []) m.set(t.id, t);
    return m;
  }, [liked.data]);

  // Resolve a display title/artist for a videoId. Liked songs carry full
  // ShelfItem metadata; everything else falls back to the play-time /
  // oEmbed-backfilled track-meta store. Returns undefined when nothing is
  // known yet (the row shows the bare id until the backfill lands).
  const resolveMeta = useCallback(
    (videoId: string): TrackMeta | undefined => {
      const item = likedMeta.get(videoId);
      if (item) {
        return {
          title: item.title,
          subtitle: item.artists?.map((a) => a.name).join(", ") || item.subtitle,
          artists: item.artists,
        };
      }
      return trackMeta[videoId];
    },
    [likedMeta, trackMeta],
  );

  // Back-fill titles for cached tracks we don't recognise yet (typically
  // ones cached before the track-meta store existed). Keyed on the cache
  // set + liked set only — we read the meta store via getState so the
  // effect doesn't re-fire on every backfill write. The fetch layer dedupes
  // and skips already-known/failed ids.
  useEffect(() => {
    const known = useTrackMetaStore.getState().byId;
    const unknown = (cache.data ?? [])
      .map((e) => e.videoId)
      .filter((id) => !likedMeta.has(id) && !known[id]);
    if (unknown.length) void backfillTrackMeta(unknown);
  }, [cache.data, likedMeta]);

  const filtered = useMemo(() => {
    let list = cache.data ?? [];
    if (filter === "liked") list = list.filter((e) => likedMeta.has(e.videoId));
    else if (filter === "notLiked")
      list = list.filter((e) => !likedMeta.has(e.videoId));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const meta = resolveMeta(e.videoId);
        const haystack = [meta?.title, meta?.subtitle, e.videoId]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    const sorted = [...list].sort((a, b) => {
      if (sort === "newest") return b.modifiedSecs - a.modifiedSecs;
      if (sort === "oldest") return a.modifiedSecs - b.modifiedSecs;
      return b.size - a.size;
    });
    return sorted;
  }, [cache.data, filter, sort, likedMeta, search, resolveMeta]);

  const totalBytes = (cache.data ?? []).reduce((a, e) => a + e.size, 0);
  const likedInCache = (cache.data ?? []).filter((e) =>
    likedMeta.has(e.videoId),
  ).length;
  const notLikedInCache = (cache.data ?? []).length - likedInCache;

  const deleteEntries = async (ids: string[], label: string) => {
    try {
      const freed = await invoke<number>("delete_cache_entries", {
        videoIds: ids,
      });
      await qc.invalidateQueries({ queryKey: ["cache-list"] });
      // Drop the in-memory prefetch log: anything we'd previously marked as
      // "warm" might now be gone from disk and should be re-prefetchable.
      clearPrefetchMemo();
      toast.success(`${label} — freed ${formatBytes(freed)}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const deleteOne = async (id: string) => {
    setPending((p) => new Set(p).add(id));
    await deleteEntries([id], "Removed");
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  };

  const clearAll = async () => {
    if (!cache.data?.length) return;
    if (
      !confirm(
        `Delete all ${cache.data.length} cached tracks (${formatBytes(
          totalBytes,
        )})? Liked songs will be removed too.`,
      )
    )
      return;
    setBulkBusy(true);
    await deleteEntries([], "Cleared cache");
    setBulkBusy(false);
  };

  const clearNotLiked = async () => {
    const ids = (cache.data ?? [])
      .filter((e) => !likedMeta.has(e.videoId))
      .map((e) => e.videoId);
    if (!ids.length) {
      toast.info("Nothing to clear — everything cached is liked.");
      return;
    }
    if (!confirm(`Delete ${ids.length} non-liked tracks?`)) return;
    setBulkBusy(true);
    await deleteEntries(ids, "Cleared non-liked");
    setBulkBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <DatabaseIcon className="size-5" />
              Cache
            </CardTitle>
            <CardDescription>
              Tracks you've played stay on disk so they're instant on replay.
              {loggedIn
                ? " Liked songs are labelled so you can clear only the noise."
                : " Sign in above to show which cached tracks are in your liked songs."}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {cache.data?.length ?? 0} tracks · {formatBytes(totalBytes)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Storage limit</span>
              <span className="text-xs text-muted-foreground">
                {limit === 0
                  ? `Unlimited · using ${formatBytes(totalBytes)}`
                  : `Using ${formatBytes(totalBytes)} of ${formatBytes(limit)}`}
              </span>
            </div>
            <select
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={limitQuery.isLoading}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Cache storage limit"
            >
              {CACHE_LIMIT_OPTIONS.map((o) => (
                <option key={o.bytes} value={String(o.bytes)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {limit > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  totalBytes >= limit ? "bg-amber-500" : "bg-primary",
                )}
                style={{
                  width: `${Math.min(100, (totalBytes / limit) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cached tracks by title or artist…"
            className="h-9 ps-8"
            aria-label="Search cached tracks"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`All (${cache.data?.length ?? 0})`}
          />
          <FilterChip
            active={filter === "liked"}
            onClick={() => setFilter("liked")}
            label={`Liked (${likedInCache})`}
            disabled={!loggedIn}
          />
          <FilterChip
            active={filter === "notLiked"}
            onClick={() => setFilter("notLiked")}
            label={`Not liked (${notLikedInCache})`}
            disabled={!loggedIn}
          />
          <div className="ms-auto flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest first</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={clearNotLiked}
              disabled={bulkBusy || !loggedIn || notLikedInCache === 0}
            >
              Clear non-liked
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearAll}
              disabled={bulkBusy || !cache.data?.length}
            >
              {bulkBusy ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
              Clear all
            </Button>
          </div>
        </div>

        <div className="flex flex-col divide-y divide-border rounded-md border max-h-[480px] overflow-y-auto">
          {cache.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {cache.data?.length === 0
                ? "Cache is empty — tracks land here as you play them."
                : search.trim()
                  ? "No tracks match your search."
                  : "No tracks match this filter."}
            </div>
          ) : (
            filtered.map((entry) => (
              <CacheRow
                key={entry.videoId}
                entry={entry}
                meta={resolveMeta(entry.videoId)}
                isLiked={likedMeta.has(entry.videoId)}
                isDeleting={pending.has(entry.videoId)}
                onDelete={() => deleteOne(entry.videoId)}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

function CacheRow({
  entry,
  meta,
  isLiked,
  isDeleting,
  onDelete,
}: {
  entry: CacheEntry;
  meta: TrackMeta | undefined;
  isLiked: boolean;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  // YouTube publishes thumbnails for every videoId on a public CDN, so we
  // can render one without needing a real API round-trip just to draw
  // this row.
  const thumb = `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`;
  const title = meta?.title ?? entry.videoId;
  const subtitle =
    meta?.artists?.map((a) => a.name).join(", ") || meta?.subtitle || "";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2",
        isDeleting && "opacity-50",
      )}
    >
      <img
        src={thumb}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-10 w-14 shrink-0 rounded object-cover bg-muted"
        onLoad={(e) => {
          // WebKitGTK paints YouTube's 404 grey placeholder (120×90) as a
          // successful load, so hide it by its tell-tale tiny size too.
          const img = e.currentTarget;
          if (img.naturalWidth <= 120 && img.naturalHeight <= 90) {
            img.style.visibility = "hidden";
          }
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {isLiked && (
            <Badge
              variant="secondary"
              className="gap-1 bg-rose-500/15 text-rose-600 dark:text-rose-400"
            >
              <HeartIcon className="size-3 fill-current" />
              Liked
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {subtitle ? `${subtitle} · ` : ""}
          {formatBytes(entry.size)} ·{" "}
          {formatRelative(entry.modifiedSecs)}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={isDeleting}
        aria-label="Delete cached track"
      >
        {isDeleting ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
      </Button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatRelative(unixSecs: number): string {
  if (!unixSecs) return "";
  const diff = Math.max(0, Date.now() / 1000 - unixSecs);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(unixSecs * 1000);
  return d.toLocaleDateString();
}
