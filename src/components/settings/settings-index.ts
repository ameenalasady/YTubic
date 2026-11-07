import type { IntegrationPage, SettingsTab } from "@/lib/store/settings-dialog";

/** Fewest characters before the search starts ("more than 2 letters"). */
export const MIN_QUERY_LENGTH = 3;

export type SettingEntry = {
  tab: SettingsTab;
  title: string;
  description: string;
  /** Extra words people might type that the row's own text does not contain. */
  keywords?: string;
  /** Integrations only: the drill-in page the row lives on. */
  page?: IntegrationPage;
  /** DOM id the row carries (`data-setting`); defaults to the title's slug. */
  id?: string;
};

export const settingSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const entryId = (e: SettingEntry): string =>
  e.id ?? settingSlug(e.title);

/**
 * Everything the search can find. The tabs render their own rows, so this
 * is a hand-kept mirror of their titles and descriptions; the test next to
 * it fails when a row is added or renamed without updating this list.
 */
export const SETTINGS_INDEX: SettingEntry[] = [
  // General
  {
    tab: "general",
    title: "Launch at Startup",
    description: "Start YTubic automatically when you log in.",
    keywords: "autostart boot login",
  },
  {
    tab: "general",
    title: "Playback Notifications",
    description:
      "Show a system notification when the track changes in the background.",
    keywords: "toast alert popup",
  },
  {
    tab: "general",
    title: "Close to tray",
    id: "close-to-tray",
    description:
      "Hide YTubic to the tray when you press ✕ instead of quitting.",
    keywords: "menu bar minimize background quit exit",
  },
  {
    tab: "general",
    title: "Automatic Updates",
    description:
      "Download updates quietly and install them on your next restart.",
    keywords: "update upgrade version",
  },

  // Playback
  {
    tab: "playback",
    title: "Crossfade",
    description: "Fade the end of a track into the start of the next one.",
    keywords: "transition mix blend seconds",
  },
  {
    tab: "playback",
    title: "DJ Bass Swap",
    description:
      "Swap basslines during the crossfade so the two tracks don't clash.",
    keywords: "dj mix low end",
  },
  {
    tab: "playback",
    title: "Smart Mix Timing",
    description:
      "Start the mix as the outro begins and skip silent intros and endings.",
    keywords: "dj mix outro intro silence",
  },
  {
    tab: "playback",
    title: "Volume Normalization",
    description: "Keep every track at a similar loudness.",
    keywords: "loudness level volume leveling",
  },
  {
    tab: "playback",
    title: "Mono Audio",
    description: "Play the same audio in both channels.",
    keywords: "stereo channels accessibility",
  },
  {
    tab: "playback",
    title: "Equalizer",
    description: "Shape the sound with a preset, or tune the bands yourself.",
    keywords: "eq bass boost vocal treble late night preset bands custom",
  },
  {
    tab: "playback",
    title: "Output Device",
    description: "Where audio is sent when YTubic starts playing.",
    keywords: "speakers headphones audio sink soundcard",
  },
  {
    tab: "playback",
    title: "Back Button",
    description: "What happens when you press previous mid-track.",
    keywords: "previous skip restart rewind",
  },
  {
    tab: "playback",
    title: "Resume Where You Left Off",
    description: "Remember the track and position after a restart.",
    keywords: "restore last session position",
  },
  {
    tab: "playback",
    title: "Varied Radio & Autoplay",
    description:
      "Mix more tracks into radio and autoplay and shuffle them a bit, so it isn't the same songs every time.",
    keywords: "randomize random shuffle station variety",
  },

  // Appearance
  {
    tab: "appearance",
    title: "Theme",
    description: "Choose light or dark, or follow your OS preference.",
    keywords: "dark light mode system colors",
  },
  {
    tab: "appearance",
    title: "Ambient Background",
    description:
      "Tint the window with the current album art, or keep it plain.",
    keywords: "cover colour color blur",
  },
  {
    tab: "appearance",
    title: "Window Glow",
    description: "A soft glowing accent outline around the window edge.",
    keywords: "outline border light neon",
  },
  {
    tab: "appearance",
    title: "Glow Matches Cover",
    description:
      "Tint the window glow with the current cover's dominant color.",
    keywords: "colour adapt album art",
  },
  {
    tab: "appearance",
    title: "Glow Size",
    description: "How far the window glow reaches into the window.",
    keywords: "thickness width slider",
  },
  {
    tab: "appearance",
    title: "Video Quality",
    description:
      "Picture quality for Video mode in immersive fullscreen. Higher takes longer to load the first time.",
    keywords: "720p 1080p 1440p resolution hd",
  },
  {
    tab: "appearance",
    title: "Rating Buttons",
    description: "Show a single heart, or separate like and dislike buttons.",
    keywords: "like dislike thumbs heart favourite favorite",
  },
  {
    tab: "appearance",
    title: "Player Layout",
    description: "Choose where the now-playing card lives.",
    keywords: "now playing card sidebar bar position",
  },
  {
    tab: "appearance",
    title: "Fullscreen Player Layout",
    description: "How the now-playing screen fills the display.",
    keywords: "immersive cover lyrics video",
  },
  {
    tab: "appearance",
    title: "Interface Font",
    description: "Applies to the whole app. Track and artist names use it too.",
    keywords: "typeface text size",
  },

  // Home
  {
    tab: "home",
    title: "Section order",
    description: "Drag to reorder the sections shown on the Home page.",
    keywords: "home page sort arrange",
  },

  // Storage
  {
    tab: "storage",
    title: "Cache folder",
    description: "Where downloaded tracks are kept on disk.",
    keywords: "path directory location open",
  },
  {
    tab: "storage",
    title: "Storage limit",
    description: "How much disk space the track cache may use.",
    keywords: "size disk space gigabytes unlimited",
  },
  {
    tab: "storage",
    title: "Auto-clean tracks not in library",
    description: "Periodically delete cached tracks you haven't saved.",
    keywords: "delete remove clean up cache",
  },
  {
    tab: "storage",
    title: "Cover art cache",
    description: "Cached album art images.",
    keywords: "clear delete images thumbnails",
  },

  // Integrations
  {
    tab: "integrations",
    title: "Last.fm",
    page: "lastfm",
    description:
      "Scrobble what you play and share your now-playing status. Uses your own Last.fm API account.",
    keywords: "scrobble scrobbling api key lastfm account",
  },
  {
    tab: "integrations",
    title: "Scrobble tracks",
    page: "lastfm",
    description: "Send plays and now-playing updates to Last.fm.",
    keywords: "scrobbling lastfm",
  },
  {
    tab: "integrations",
    title: "Love liked tracks",
    page: "lastfm",
    description: "When you like a song in YTubic, also love it on Last.fm.",
    keywords: "heart favourite favorite lastfm",
  },
  {
    tab: "integrations",
    title: "Discord Rich Presence",
    page: "discord",
    description:
      "Show what you're playing on your Discord profile. Talks directly to your local Discord app.",
    keywords: "status activity",
  },
  {
    tab: "integrations",
    title: "Activity type",
    page: "discord",
    description: 'The verb in "<verb> <app name>".',
    keywords: "discord listening playing watching",
  },
  {
    tab: "integrations",
    title: "Track title",
    page: "discord",
    description: 'Shown as the "details" line.',
    keywords: "discord presence",
  },
  {
    tab: "integrations",
    title: "Artist",
    page: "discord",
    description: 'Shown as the "state" line.',
    keywords: "discord presence",
  },
  {
    tab: "integrations",
    title: "Album art",
    page: "discord",
    description: "Large cover image.",
    keywords: "discord presence cover",
  },
  {
    tab: "integrations",
    title: "Album name",
    page: "discord",
    description: "Shown when hovering the cover.",
    keywords: "discord presence",
  },
  {
    tab: "integrations",
    title: "Elapsed time",
    page: "discord",
    description: "Live progress bar (e.g. 01:36 / 02:51).",
    keywords: "discord presence progress",
  },
  {
    tab: "integrations",
    title: '"Listen" button',
    page: "discord",
    description: "Links back to the track on YouTube Music.",
    keywords: "discord presence link",
  },
  {
    tab: "integrations",
    title: "Only show for songs",
    page: "discord",
    description:
      "Hide presence for standalone music videos — only share real album songs.",
    keywords: "discord presence music videos",
  },
  {
    tab: "integrations",
    title: "Hide while paused",
    page: "discord",
    description:
      "Clear presence when playback is paused, instead of freezing the bar.",
    keywords: "discord presence pause",
  },
];

export type SettingMatch = { entry: SettingEntry; rank: number };

/** Lower-cased words of a query. Each must occur somewhere in a row. */
export const queryTerms = (query: string): string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Rows matching `query`, best first. Matching is by letter combination, not
 * whole word ("fade" finds "Crossfade"), and every word of the query has to
 * be found in the row's title, description, keywords or tab name. A hit in
 * the title ranks above one in the description, above one in the keywords.
 * Returns nothing until the query reaches MIN_QUERY_LENGTH characters.
 */
export function searchSettings(
  query: string,
  tabLabel: (tab: SettingsTab) => string = (t) => t,
): SettingMatch[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const terms = queryTerms(trimmed);

  const out: SettingMatch[] = [];
  SETTINGS_INDEX.forEach((entry, order) => {
    const title = entry.title.toLowerCase();
    const desc = entry.description.toLowerCase();
    const extra =
      `${entry.keywords ?? ""} ${tabLabel(entry.tab)}`.toLowerCase();
    let rank = 0;
    for (const term of terms) {
      if (title.includes(term)) rank += title.startsWith(term) ? 0 : 1;
      else if (desc.includes(term)) rank += 10;
      else if (extra.includes(term)) rank += 20;
      else return; // a term found nowhere: not a match
    }
    out.push({ entry, rank: rank * 1000 + order });
  });
  return out.sort((a, b) => a.rank - b.rank);
}
