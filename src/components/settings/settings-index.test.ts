import { describe, expect, it } from "vitest";
import {
  MIN_QUERY_LENGTH,
  SETTINGS_INDEX,
  entryId,
  searchSettings,
  settingSlug,
} from "./settings-index";

// The tabs' own source, to keep the hand-kept index honest.
const tabSources = import.meta.glob("./*-tab.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const titles = (q: string) => searchSettings(q).map((m) => m.entry.title);

describe("searchSettings", () => {
  it("does nothing until the query is long enough", () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(titles("")).toEqual([]);
    expect(titles("fa")).toEqual([]);
    expect(titles("  fa ")).toEqual([]);
    expect(titles("fad").length).toBeGreaterThan(0);
  });

  it("matches letter combinations, not whole words", () => {
    expect(titles("fade")).toContain("Crossfade");
    expect(titles("ross")).toContain("Crossfade");
    expect(titles("FADE")).toContain("Crossfade");
  });

  it("ranks a title hit above a description-only hit", () => {
    // "mix" is in Smart Mix Timing's title and in other rows' descriptions.
    const out = titles("mix");
    expect(out[0]).toBe("Smart Mix Timing");
  });

  it("requires every word of the query", () => {
    expect(titles("bass swap")).toEqual(["DJ Bass Swap"]);
    expect(titles("bass zzzzz")).toEqual([]);
  });

  it("finds rows by their extra keywords and by tab name", () => {
    expect(titles("scrobble")).toContain("Last.fm");
    expect(titles("1440p")).toContain("Video Quality");
    expect(titles("integrations")).toEqual(
      expect.arrayContaining(["Last.fm", "Discord Rich Presence"]),
    );
  });

  it("treats regex characters in the query literally", () => {
    expect(() => searchSettings("(.*)")).not.toThrow();
    expect(titles("last.fm")).toContain("Last.fm");
  });
});

describe("settings index", () => {
  it("has unique ids", () => {
    const ids = SETTINGS_INDEX.map(entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only lists rows that exist in their tab", () => {
    for (const e of SETTINGS_INDEX) {
      const src = tabSources[`./${e.tab}-tab.tsx`];
      expect(src, `missing tab file for ${e.tab}`).toBeTruthy();
      expect(
        src.includes(e.title),
        `"${e.title}" not found in ${e.tab} tab`,
      ).toBe(true);
    }
  });

  it("lists every titled row of every tab", () => {
    // Titles that are not settings rows (icon-button tooltips and the like).
    const NOT_ROWS = new Set(["In library"]);
    const indexed = new Set(SETTINGS_INDEX.map((e) => e.title));
    for (const [file, src] of Object.entries(tabSources)) {
      for (const m of src.matchAll(/\btitle="([^"]+)"/g)) {
        const title = m[1];
        if (NOT_ROWS.has(title)) continue;
        expect(
          indexed.has(title),
          `"${title}" (${file}) is not in the index`,
        ).toBe(true);
      }
    }
  });

  it("slugs titles predictably", () => {
    expect(settingSlug("Glow Matches Cover")).toBe("glow-matches-cover");
    expect(settingSlug("Last.fm")).toBe("last-fm");
  });
});
