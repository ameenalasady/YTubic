import { fetchSearch } from "./search";
import type { ShelfItem } from "./types";
import type { SourceKind } from "@/lib/store/track-source";

/** What we know about the track being switched, used to pick the right match. */
export type AlternateHint = {
  title: string;
  artists?: string[];
  /** Seconds, when known. */
  duration?: number;
};

/** Words that say "this is the video/audio upload" rather than naming the song. */
const NOISE = new Set([
  "official",
  "video",
  "videoclip",
  "music",
  "audio",
  "lyrics",
  "lyric",
  "hd",
  "hq",
  "4k",
  "mv",
  "visualizer",
  "visualiser",
  "explicit",
  "clean",
  "remastered",
  "remaster",
  "version",
  "feat",
  "ft",
  "featuring",
  "with",
  "the",
  "a",
  "an",
  "and",
  "of",
  "topic",
]);

/** Tokens that mark a different recording; a candidate carrying one the
 *  original lacks is probably not the same song. */
const VARIANT = new Set([
  "remix",
  "cover",
  "live",
  "karaoke",
  "instrumental",
  "sped",
  "slowed",
  "reverb",
  "nightcore",
  "acoustic",
  "8d",
  "mashup",
  "edit",
  "reprise",
]);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);

const significant = (s: string) => tokens(s).filter((t) => !NOISE.has(t));

/**
 * Judge one search result against the track being switched. Returns null
 * when it is not convincingly the same recording, otherwise a ranking
 * score. Every gate must pass: a wrong video with right-sounding words in
 * the title is worse than no video, so near-misses are rejected rather
 * than ranked.
 */
function evaluate(
  item: ShelfItem,
  hint: AlternateHint,
  currentVideoId: string,
  targetKind: SourceKind,
): number | null {
  // 1. Title: nearly every meaningful word of the original must be there,
  //    and the candidate must not announce a different version.
  const want = significant(hint.title);
  const got = new Set(significant(item.title));
  if (want.length === 0) return null;
  const coverage = want.filter((t) => got.has(t)).length / want.length;
  if (coverage < 0.75) return null;
  const wantSet = new Set(want);
  for (const t of got) {
    if (VARIANT.has(t) && !wantSet.has(t)) return null;
  }

  // 2. Artist.
  const names = (hint.artists ?? []).filter(Boolean);
  let artistFrac = 0;
  if (names.length > 0) {
    const haystack = [
      item.title,
      item.subtitle ?? "",
      ...(item.artists?.map((a) => a.name) ?? []),
    ]
      .join(" ")
      .toLowerCase();
    artistFrac =
      names.filter((n) => haystack.includes(n.toLowerCase())).length /
      names.length;
  }
  const artistOk = artistFrac >= 0.5;

  // 3. Duration: a music video can run a little long (intro, outro) but a
  //    big gap means a different recording or a compilation.
  const d0 = hint.duration;
  const d1 = item.duration;
  const known = !!d0 && !!d1;
  const diff = known ? Math.abs(d0 - d1) : Infinity;
  const tol = Math.max(25, (d0 ?? 0) * 0.15);
  if (known && diff > tol) return null;

  // Title alone never decides: either the artist agrees, or the length is
  // all but identical.
  if (!artistOk && !(known && diff <= 5)) return null;

  let total = coverage * 3 + artistFrac * 2;
  total += known ? (diff <= 3 ? 2 : 1) : 0.3;
  if (targetKind === "video" && item.kind === "video") total += 0.6;
  if (targetKind === "song" && item.kind === "song") total += 0.6;
  // The playing id itself is a valid answer: a track that already *is* the
  // video has no separate "video version".
  if (item.id === currentVideoId) total += 0.5;
  return total;
}

/**
 * Find the alternate-source videoId for a track (the music video for a song,
 * or the song upload for a video). The search is ranked by YT Music, but its
 * first hit is often a different recording, a cover, or a long compilation,
 * which played the wrong audio and picture. So every result must pass title,
 * artist and duration checks against `hint`, and the best survivor is
 * returned; if none survives the answer is null ("no version available"). Returns the playing id itself when the track
 * already is that kind.
 */
export async function findAlternateVideoId(
  query: string,
  currentVideoId: string,
  targetKind: SourceKind,
  hint?: AlternateHint,
): Promise<string | null> {
  if (!query.trim()) return null;
  const filter = targetKind === "video" ? "videos" : "songs";
  const results = await fetchSearch(query, filter);

  // Without a hint there is nothing to judge by: take the top result that
  // is not the playing id.
  if (!hint) {
    for (const shelf of results.shelves) {
      for (const item of shelf.items) {
        if (item.kind !== "song" && item.kind !== "video") continue;
        if (item.id !== currentVideoId) return item.id;
      }
    }
    return null;
  }

  let best: { id: string; score: number } | null = null;
  for (const shelf of results.shelves) {
    for (const item of shelf.items) {
      if (item.kind !== "song" && item.kind !== "video") continue;
      const s = evaluate(item, hint, currentVideoId, targetKind);
      if (s === null) continue;
      if (!best || s > best.score) best = { id: item.id, score: s };
    }
  }
  return best ? best.id : null;
}
