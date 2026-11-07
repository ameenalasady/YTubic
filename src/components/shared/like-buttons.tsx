import { useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconHeart,
  IconHeartFilled,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchLikedSongs } from "@/lib/innertube/library";
import type { ShelfItem } from "@/lib/innertube/types";
import { toggleDisliked, toggleLiked } from "@/lib/like-actions";
import type { LastfmTrackMeta } from "@/lib/lastfm/track";
import { useTrackMetaStore } from "@/lib/store/track-meta";
import { useDislikesStore } from "@/lib/store/dislikes";
import { useSettingsStore } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

// Module-level memo of the liked-id Set. With ~5k liked tracks and ~100
// LikeDislikeButtons on a single page, doing `(liked.data ?? []).some(...)`
// per render becomes ~500k comparisons. The Set + identity-keyed memo
// collapses that to one rebuild per actual data change, shared across all
// observers.
let likedSetMemo: { data: ShelfItem[] | undefined; set: Set<string> } = {
  data: undefined,
  set: new Set(),
};
export function getLikedIdsSet(data: ShelfItem[] | undefined): Set<string> {
  if (likedSetMemo.data === data) return likedSetMemo.set;
  const set = new Set((data ?? []).map((t) => t.id));
  likedSetMemo = { data, set };
  return set;
}

type Props = {
  videoId: string;
  className?: string;
  /** Extra classes for each button, e.g. the player footer's shared
   *  `playerIconButton` chrome so the pair matches its neighbours. */
  buttonClassName?: string;
  /** Compact mode uses size-7 ghost buttons (for track rows). Default
   *  is size-9 (for the player bar). */
  compact?: boolean;
  /** When true, only shows if the track is liked OR on hover of the
   *  row. Caller controls hover visibility via CSS; we just render
   *  the buttons and let `group-hover:*` classes do the work. */
  hideUnlessLiked?: boolean;
  /** Title/artist metadata so a like can be mirrored to Last.fm's loved
   *  tracks. Optional — falls back to the play-time track-meta store. */
  meta?: LastfmTrackMeta;
};

export function LikeDislikeButtons({
  videoId,
  className,
  buttonClassName,
  compact,
  hideUnlessLiked,
  meta,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"like" | "dislike" | null>(null);
  // Appearance -> Rating buttons: a heart, or thumbs up + thumbs down.
  const both = useSettingsStore((s) => s.ratingButtons === "both");
  const isDisliked = useDislikesStore((s) => !!s.ids[videoId]);

  // Fetched lazily on first observer (e.g. when the player bar mounts
  // with a track or a track list renders). Tanstack-query dedupes
  // across the dozens of LikeDislikeButtons instances on a page, so
  // this still triggers a single network round of continuations. The
  // result is persisted via `shouldPersistQuery` in query-client.ts,
  // so reloads stay accurate without re-fetching.
  const liked = useQuery({
    queryKey: ["liked-songs"],
    queryFn: () => fetchLikedSongs(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const isLiked = getLikedIdsSet(liked.data).has(videoId);

  const btnSize = compact ? "size-7" : "size-9";
  const iconSize = compact ? "size-3.5" : "size-4";

  const onLike = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy("like");
    const wasLiked = isLiked;
    try {
      // Mirror to Last.fm loved tracks. Prefer caller-supplied metadata;
      // fall back to what we remembered at play time (both may be absent
      // for a never-played track, in which case love-sync quietly skips).
      await toggleLiked({
        queryClient: qc,
        videoId,
        wasLiked,
        track: meta ?? useTrackMetaStore.getState().byId[videoId],
      });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const onDislike = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy("dislike");
    try {
      await toggleDisliked({
        queryClient: qc,
        videoId,
        wasDisliked: isDisliked,
        wasLiked: isLiked,
        track: meta ?? useTrackMetaStore.getState().byId[videoId],
      });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const rated = isLiked || (both && isDisliked);
  const hoverVisibility =
    hideUnlessLiked && !rated
      ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      : "";

  const LikeIcon = both
    ? isLiked
      ? IconThumbUpFilled
      : IconThumbUp
    : isLiked
      ? IconHeartFilled
      : IconHeart;
  const DislikeIcon = isDisliked ? IconThumbDownFilled : IconThumbDown;

  return (
    <div className={cn("flex items-center", hoverVisibility, className)}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(btnSize, buttonClassName)}
        onClick={onLike}
        disabled={busy !== null}
        aria-label={isLiked ? "Remove from liked" : "Add to liked"}
        aria-pressed={isLiked}
      >
        <LikeIcon className={cn(iconSize, isLiked && "text-brand")} />
      </Button>
      {both ? (
        <Button
          variant="ghost"
          size="icon"
          className={cn(btnSize, buttonClassName)}
          onClick={onDislike}
          disabled={busy !== null}
          aria-label={isDisliked ? "Remove dislike" : "Dislike"}
          aria-pressed={isDisliked}
        >
          <DislikeIcon className={cn(iconSize, isDisliked && "text-t3")} />
        </Button>
      ) : null}
    </div>
  );
}
