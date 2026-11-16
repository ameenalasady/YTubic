import { describe, expect, it } from "vitest";
import { resolveActiveSource } from "./active-source";

const base = {
  pref: "auto" as const,
  best: "ytmusic" as const,
  override: null,
  videoId: "abc",
  hasLyrics: () => true,
};

describe("resolveActiveSource", () => {
  it("follows the best source on auto", () => {
    expect(resolveActiveSource(base)).toBe("ytmusic");
  });

  it("follows the saved choice when one is pinned", () => {
    expect(resolveActiveSource({ ...base, pref: "genius" })).toBe("genius");
  });

  it("returns null when auto finds nothing", () => {
    expect(resolveActiveSource({ ...base, best: null })).toBeNull();
  });

  it("shows the reloaded source for the track it was reloaded on", () => {
    const override = { videoId: "abc", source: "lrclib" as const };
    expect(resolveActiveSource({ ...base, override })).toBe("lrclib");
    // ...even over a pinned choice, for that track.
    expect(resolveActiveSource({ ...base, pref: "genius", override })).toBe(
      "lrclib",
    );
  });

  it("ignores an override left over from another track", () => {
    const override = { videoId: "other", source: "lrclib" as const };
    expect(resolveActiveSource({ ...base, override })).toBe("ytmusic");
  });

  it("ignores an override whose source has no lyrics", () => {
    const override = { videoId: "abc", source: "lrclib" as const };
    expect(
      resolveActiveSource({
        ...base,
        override,
        hasLyrics: (s) => s !== "lrclib",
      }),
    ).toBe("ytmusic");
  });

  it("ignores the override when there is no track", () => {
    const override = { videoId: "abc", source: "lrclib" as const };
    expect(resolveActiveSource({ ...base, override, videoId: undefined })).toBe(
      "ytmusic",
    );
  });
});
