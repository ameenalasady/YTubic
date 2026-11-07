import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIKED_COVER_PRESET } from "@/lib/store/liked-cover";
import {
  LIKED_COVERS,
  LIKED_COVER_ORDER,
  LikedCover,
  LikedCoverArt,
} from "./liked-cover";

const state = vi.hoisted(() => ({
  preset: "theme",
  custom: null as string | null,
  ratingButtons: "heart",
}));

vi.mock("@/lib/store/liked-cover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store/liked-cover")>()),
  useLikedCoverStore: (selector: (value: typeof state) => unknown) =>
    selector(state),
}));
vi.mock("@/lib/store/settings", () => ({
  useSettingsStore: (selector: (value: typeof state) => unknown) =>
    selector(state),
}));

beforeEach(() => {
  state.preset = "theme";
  state.custom = null;
  state.ratingButtons = "heart";
});

describe("theme-aware Liked songs artwork", () => {
  it("puts the new default first without removing legacy choices", () => {
    expect(LIKED_COVER_ORDER[0]).toBe(DEFAULT_LIKED_COVER_PRESET);
    expect(LIKED_COVER_ORDER).toEqual([
      "theme",
      "ytubic",
      "default",
      "clear",
      "glow",
    ]);
  });

  it("uses palette colours and an outline instead of the saturated filled heart", () => {
    const html = renderToStaticMarkup(createElement(LikedCover));
    expect(html).toContain("var(--surface)");
    expect(html).toContain("var(--acc1rgb)");
    expect(html).toContain("var(--t2)");
    expect(html).toContain('fill="none"');
    expect(html).toContain("tabler-icon-heart");
    expect(html).not.toContain("backdrop-filter");
  });

  it("follows the thumbs rating preference", () => {
    state.ratingButtons = "both";
    const html = renderToStaticMarkup(createElement(LikedCover));
    expect(html).toContain("tabler-icon-thumb-up");
    expect(html).not.toContain("tabler-icon-heart");
  });

  it("keeps the legacy filled presets intact", () => {
    const html = renderToStaticMarkup(
      createElement(LikedCoverArt, { art: LIKED_COVERS.ytubic }),
    );
    expect(html).toContain("#FF5F79");
    expect(html).toContain('fill="rgba(255,255,255,0.94)"');
  });

  it("still displays uploaded artwork instead of the preset", () => {
    state.custom = "data:image/jpeg;base64,test";
    const html = renderToStaticMarkup(createElement(LikedCover));
    expect(html).toContain(state.custom);
    expect(html).not.toContain("<svg");
  });

  it("falls back to Theme for an unrecognized saved preset", () => {
    state.preset = "removed-preset";
    const html = renderToStaticMarkup(createElement(LikedCover));
    expect(html).toContain("var(--surface)");
    expect(html).toContain("tabler-icon-heart");
  });
});
