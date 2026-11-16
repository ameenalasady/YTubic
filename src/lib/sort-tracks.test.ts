import { describe, expect, it } from "vitest";
import { sortTracks } from "./sort-tracks";
import type { ShelfItem } from "@/lib/innertube/types";

const t = (
  id: string,
  title: string,
  duration?: number,
  artist?: string,
): ShelfItem =>
  ({
    id,
    kind: "video",
    title,
    duration,
    artists: artist ? [{ name: artist }] : undefined,
  }) as unknown as ShelfItem;

const list = [
  t("a", "Charlie", 200, "Zed"),
  t("b", "alpha", 100, "Amy"),
  t("c", "Bravo", 300),
];
const ids = (xs: ShelfItem[]) => xs.map((x) => x.id).join("");

describe("sortTracks", () => {
  it("keeps the server order on default, and does not copy", () => {
    expect(sortTracks(list, "default")).toBe(list);
  });

  it("sorts by title in both directions, ignoring case", () => {
    expect(ids(sortTracks(list, "title-asc"))).toBe("bca");
    expect(ids(sortTracks(list, "title-desc"))).toBe("acb");
  });

  it("sorts by duration, missing durations first", () => {
    expect(ids(sortTracks(list, "duration-asc"))).toBe("bac");
    expect(ids(sortTracks(list, "duration-desc"))).toBe("cab");
    expect(ids(sortTracks([t("x", "x"), t("y", "y", 5)], "duration-asc"))).toBe(
      "xy",
    );
  });

  it("sorts by artist", () => {
    expect(ids(sortTracks(list, "artist-asc"))).toBe("cba");
  });

  it("reverses for oldest first, and never mutates its input", () => {
    const before = ids(list);
    expect(ids(sortTracks(list, "date-added-asc"))).toBe("cba");
    expect(ids(list)).toBe(before);
  });
});
