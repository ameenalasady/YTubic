import { describe, expect, it } from "vitest";
import { findActiveIndex, normalizeTitle } from "./track-match";
import type { ShelfItem } from "@/lib/innertube/types";
import type { QueueTrack } from "@/lib/store/playback";

const MJ = { id: "UCoIOOL7QKuBhQHVKL8y7BEQ", name: "Michael Jackson" };

function row(
  id: string,
  title: string,
  duration?: number,
  extra: Partial<ShelfItem> = {},
): ShelfItem {
  return {
    kind: "song",
    id,
    title,
    artists: [MJ],
    duration,
    thumbnails: [],
    ...extra,
  } as ShelfItem;
}

// Thriller's album page lists music-video ids; Quick picks played the audio id.
const album = [
  row("sOnqjkJTMaA", "Thriller", 358),
  row("oRdxUFDoQe0", "Beat It", 259),
  row("Zi_XLOBDo_Y", "Billie Jean", 295),
];

const playing: QueueTrack = {
  videoId: "kOn-HdEg6AQ",
  title: "Beat It",
  artists: [MJ],
  album: "Thriller",
  albumId: "MPREb_dqWTncCjkSp",
  thumbnails: [],
};

describe("findActiveIndex", () => {
  it("prefers an exact id", () => {
    const list = [...album, row("kOn-HdEg6AQ", "Beat It", 258)];
    expect(findActiveIndex(list, playing, 258)).toBe(3);
  });

  it("matches the other version of the same song by title and length", () => {
    expect(findActiveIndex(album, playing, 258)).toBe(1);
  });

  it("uses the queue entry's own duration when present", () => {
    expect(findActiveIndex(album, { ...playing, duration: 260 })).toBe(1);
  });

  it("matches on album id when durations are unknown", () => {
    const list = [
      row("x", "Beat It", undefined, { albumId: "MPREb_dqWTncCjkSp" }),
    ];
    expect(findActiveIndex(list, playing)).toBe(0);
  });

  it("does not match a same-titled song with a different length", () => {
    // A live or extended cut shares the title but not the length.
    const list = [row("live", "Beat It", 320)];
    expect(findActiveIndex(list, playing, 258)).toBe(-1);
  });

  it("does not match a different artist's song with the same title", () => {
    const list = [
      row("cover", "Beat It", 258, { artists: [{ name: "Fall Out Boy" }] }),
    ];
    expect(findActiveIndex(list, playing, 258)).toBe(-1);
  });

  it("marks nothing when the fallback is ambiguous", () => {
    const list = [row("a", "Beat It", 258), row("b", "Beat It", 259)];
    expect(findActiveIndex(list, playing, 258)).toBe(-1);
  });

  it("ignores rows that aren't songs or videos", () => {
    const list = [row("a", "Beat It", 258, { kind: "album" })];
    expect(findActiveIndex(list, playing, 258)).toBe(-1);
  });

  it("returns -1 with nothing playing", () => {
    expect(findActiveIndex(album, null)).toBe(-1);
  });
});

describe("normalizeTitle", () => {
  it("drops feature credits, accents and punctuation", () => {
    expect(normalizeTitle("The Girl Is Mine (feat. Paul McCartney)")).toBe(
      "the girl is mine",
    );
    expect(normalizeTitle("Wanna Be Startin' Somethin'")).toBe(
      "wanna be startin somethin",
    );
    expect(normalizeTitle("Café [with Someone]")).toBe("cafe");
  });

  it("keeps other parentheticals, which name a different recording", () => {
    expect(normalizeTitle("Beat It (Live)")).not.toBe(
      normalizeTitle("Beat It"),
    );
  });
});
