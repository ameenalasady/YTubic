import type { AlbumPage, MinimalArtist, ShelfItem } from "./types";
import { parseTrackCount } from "./parse-count";
import {
  collectResponsiveRows,
  mapResponsiveListItem,
  rawBrowse,
  readRuns,
  readThumbnails,
  type YtNode,
} from "./shared";

// Matches a month-name date ("January 1, 2020", "Jan 1, 2020", "1
// January 2020") in case a subtitle run ever carries a full release
// date instead of just a bare year — no known InnerTube field for
// this, so the header's own subtitle runs are the only place to look.
const FULL_DATE_RE =
  /^(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4})$/;

function extractAlbumHeader(json: YtNode): YtNode {
  return (
    json?.header?.musicDetailHeaderRenderer ??
    json?.header?.musicResponsiveHeaderRenderer ??
    json?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]
      ?.musicResponsiveHeaderRenderer ??
    {}
  );
}

export async function fetchAlbum(id: string): Promise<AlbumPage> {
  const json = await rawBrowse(id);

  if (import.meta.env.DEV) {
    console.debug("[album] browse response", id, json);
  }

  const header = extractAlbumHeader(json);

  const title = readRuns(header.title);
  const thumbnails = readThumbnails(
    header.thumbnail?.musicThumbnailRenderer?.thumbnail ??
      header.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail ??
      header.thumbnail?.musicThumbnailRenderer ??
      header.thumbnail,
  );

  // Subtitle typically: "Album • Artist • 2024" (single column) or split
  // across `straplineTextOne` + `subtitle` runs in the responsive header.
  const subtitleRuns: YtNode[] = [
    ...((header.subtitle?.runs ?? []) as YtNode[]),
    ...((header.straplineTextOne?.runs ?? []) as YtNode[]),
  ];
  const artists: MinimalArtist[] = [];
  let year: string | undefined;
  let releaseDate: string | undefined;
  for (const run of subtitleRuns) {
    const browseId = run.navigationEndpoint?.browseEndpoint?.browseId as
      | string
      | undefined;
    const pageType = run.navigationEndpoint?.browseEndpoint
      ?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType as string | undefined;
    if (browseId && pageType?.includes("ARTIST")) {
      artists.push({ id: browseId, name: run.text ?? "" });
    } else {
      const text = (run.text ?? "").trim();
      if (/^\d{4}$/.test(text)) {
        year = text;
      } else if (FULL_DATE_RE.test(text)) {
        // Most album subtitles only carry a bare year, but if YT ever
        // sends a full date here (e.g. "January 1, 2020"), prefer it —
        // same subtitle runs, just a more precise string.
        releaseDate = text;
      }
    }
  }

  const secondSubtitleRuns: YtNode[] = header.secondSubtitle?.runs ?? [];
  const secondText = secondSubtitleRuns
    .map((r) => r.text ?? "")
    .join("")
    .trim();
  // "12 songs • 45 minutes"
  const trackCount = parseTrackCount(secondText);
  const durationMatch = secondText.split("•")[1]?.trim();

  // Walk the whole response. Album layouts vary (singleColumn vs
  // twoColumn, musicShelfRenderer vs musicPlaylistShelfRenderer wrapper)
  // but the row renderer is always the same, so a tree walk is robust.
  const seenIds = new Set<string>();
  const tracks: ShelfItem[] = [];
  for (const row of collectResponsiveRows(json)) {
    const mapped = mapResponsiveListItem(row);
    if (mapped && mapped.kind === "song" && !seenIds.has(mapped.id)) {
      seenIds.add(mapped.id);
      tracks.push(mapped);
    }
  }

  return {
    id,
    title,
    artists,
    year,
    releaseDate,
    trackCount,
    duration: durationMatch,
    thumbnails,
    tracks,
  };
}
