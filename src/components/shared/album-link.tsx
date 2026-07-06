import { Link } from "@tanstack/react-router";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { isFloatingPlayerWindow } from "@/lib/floating-player";

type Props = {
  /** Album browse id (e.g. "MPREb_…"). When absent the name renders as
   *  plain, unclickable text. */
  albumId?: string;
  name: string;
  className?: string;
};

/**
 * Album name that links to `/album/$id` when we know the browse id.
 * Same cross-window story as `ArtistLinks`: the floating player window
 * has no router, so a click emits `nav:album` via Tauri events and pulls
 * the main window forward, where `<AppShell>` runs the real navigation.
 */
export function AlbumLink({ albumId, name, className }: Props) {
  if (!albumId) {
    return <span className={className}>{name}</span>;
  }

  const cls = cn(
    "cursor-pointer transition-colors hover:text-foreground hover:underline",
    className,
  );

  if (isFloatingPlayerWindow()) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => {
          void emit("nav:album", { id: albumId });
          void invoke("focus_main_window").catch(() => {
            /* command might not be registered in older builds */
          });
        }}
      >
        {name}
      </button>
    );
  }

  return (
    <Link to="/album/$id" params={{ id: albumId }} className={cls}>
      {name}
    </Link>
  );
}
