import { IconChevronDown, IconSortDescending } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlaylistSortMode } from "@/lib/store/playlist-sort";

const SORT_LABELS: Record<PlaylistSortMode, string> = {
  default: "Date added (newest)",
  "date-added-asc": "Date added (oldest)",
  "title-asc": "Title (A–Z)",
  "title-desc": "Title (Z–A)",
  "artist-asc": "Artist (A–Z)",
  "duration-asc": "Duration (shortest)",
  "duration-desc": "Duration (longest)",
};

/** The "Sort by" dropdown shared by playlist pages and video lists. */
export function SortMenu({
  mode,
  onChange,
  isLikedSongs,
}: {
  mode: PlaylistSortMode;
  onChange: (m: PlaylistSortMode) => void;
  isLikedSongs: boolean;
}) {
  const options: PlaylistSortMode[] = [
    "default",
    "date-added-asc",
    "title-asc",
    "title-desc",
    "artist-asc",
    "duration-asc",
    "duration-desc",
  ];
  // Non-Liked playlists have a server-defined order that isn't always
  // chronological — relabel "default" to something accurate.
  const labelFor = (m: PlaylistSortMode) =>
    m === "default" && !isLikedSongs ? "Default order" : SORT_LABELS[m];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <IconSortDescending />
          {labelFor(mode)}
          <IconChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => onChange(v as PlaylistSortMode)}
        >
          {options.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {labelFor(m)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
