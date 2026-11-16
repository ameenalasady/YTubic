import { describe, expect, it } from "vitest";
import {
  isArtistPageType,
  mapPlaylistPanelVideo,
  mapShelfWrapper,
  pageTypeToKind,
  splitSetCookieHeader,
  type YtNode,
} from "./shared";

// Fallback splitter for runtimes without Headers.getSetCookie. The
// tricky part is NOT splitting on the comma inside an Expires date.
describe("splitSetCookieHeader", () => {
  it("returns [] for an empty header", () => {
    expect(splitSetCookieHeader("")).toEqual([]);
  });

  it("keeps a single cookie with an Expires date intact", () => {
    const raw =
      "SIDCC=AKEy_abc123; Expires=Tue, 07 Jul 2027 18:24:08 GMT; Path=/; Domain=.youtube.com; Secure";
    expect(splitSetCookieHeader(raw)).toEqual([raw]);
  });

  it("splits two cookies joined with a comma", () => {
    const a =
      "SIDCC=AKEy_abc; Expires=Tue, 07 Jul 2027 18:24:08 GMT; Domain=.youtube.com; Path=/";
    const b =
      "LOGIN_INFO=AFmmF2s:QUQ3; Expires=Thu, 06 Jul 2028 18:24:08 GMT; Domain=.youtube.com; Path=/; Secure; HttpOnly";
    expect(splitSetCookieHeader(`${a}, ${b}`)).toEqual([a, b]);
  });

  it("handles __Secure- prefixed names after the comma", () => {
    const a = "SIDCC=v1; Domain=.youtube.com; Path=/";
    const b = "__Secure-3PSIDCC=v2; Domain=.youtube.com; Path=/; Secure";
    expect(splitSetCookieHeader(`${a}, ${b}`)).toEqual([a, b]);
  });
});

// Shelf "More" endpoint extraction — shapes observed live on artist
// pages 2026-07-12: carousels carry it in the header's moreContentButton,
// the Top-songs musicShelfRenderer in bottomEndpoint / the title run.
describe("mapShelfWrapper more endpoint", () => {
  const browse = (browseId: string, params?: string, pageType?: string) => ({
    browseEndpoint: {
      browseId,
      params,
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: { pageType },
      },
    },
  });

  const twoRowItem: YtNode = {
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: "Album X" }] },
      navigationEndpoint: {
        browseEndpoint: {
          browseId: "MPREb_x",
          browseEndpointContextSupportedConfigs: {
            browseEndpointContextMusicConfig: {
              pageType: "MUSIC_PAGE_TYPE_ALBUM",
            },
          },
        },
      },
    },
  };

  it("reads moreContentButton off a carousel header", () => {
    const wrapper: YtNode = {
      musicCarouselShelfRenderer: {
        header: {
          musicCarouselShelfBasicHeaderRenderer: {
            title: { runs: [{ text: "Albums" }] },
            moreContentButton: {
              buttonRenderer: {
                navigationEndpoint: browse(
                  "MPADUC_a",
                  "ggMI",
                  "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY",
                ),
              },
            },
          },
        },
        contents: [twoRowItem],
      },
    };
    const { more } = mapShelfWrapper(wrapper, 0);
    expect(more).toEqual({
      browseId: "MPADUC_a",
      params: "ggMI",
      pageType: "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY",
    });
  });

  it("falls back to the title run's navigationEndpoint on a musicShelfRenderer", () => {
    const wrapper: YtNode = {
      musicShelfRenderer: {
        title: {
          runs: [
            {
              text: "Top songs",
              navigationEndpoint: browse(
                "VLOLAK_top",
                "ggMCCAI%3D",
                "MUSIC_PAGE_TYPE_PLAYLIST",
              ),
            },
          ],
        },
        contents: [twoRowItem],
      },
    };
    const { more } = mapShelfWrapper(wrapper, 0);
    expect(more?.browseId).toBe("VLOLAK_top");
    expect(more?.pageType).toBe("MUSIC_PAGE_TYPE_PLAYLIST");
  });

  it("returns undefined when the shelf has no more endpoint", () => {
    const wrapper: YtNode = {
      musicCarouselShelfRenderer: {
        header: {
          musicCarouselShelfBasicHeaderRenderer: {
            title: { runs: [{ text: "Fans might also like" }] },
          },
        },
        contents: [twoRowItem],
      },
    };
    expect(mapShelfWrapper(wrapper, 0).more).toBeUndefined();
  });
});

// A channel that only uploads videos (remixes, slowed versions, covers) has
// no artist page of its own on YT Music: its runs point at a USER_CHANNEL
// browse page. Those names used to render as inert text.
describe("channels count as artists", () => {
  const nav = (browseId: string, pageType: string) => ({
    browseEndpoint: {
      browseId,
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: { pageType },
      },
    },
  });

  it("recognises artist and channel page types, and nothing else", () => {
    expect(isArtistPageType("MUSIC_PAGE_TYPE_ARTIST")).toBe(true);
    expect(isArtistPageType("MUSIC_PAGE_TYPE_USER_CHANNEL")).toBe(true);
    expect(isArtistPageType("MUSIC_PAGE_TYPE_ALBUM")).toBe(false);
    expect(isArtistPageType("MUSIC_PAGE_TYPE_PLAYLIST")).toBe(false);
    expect(isArtistPageType("")).toBe(false);
    expect(isArtistPageType(undefined)).toBe(false);
  });

  it("maps a channel page to the artist kind", () => {
    expect(pageTypeToKind("MUSIC_PAGE_TYPE_USER_CHANNEL")).toBe("artist");
    expect(pageTypeToKind("MUSIC_PAGE_TYPE_ARTIST")).toBe("artist");
    expect(pageTypeToKind("MUSIC_PAGE_TYPE_ALBUM")).toBe("album");
  });

  it("links the uploader in a video's byline", () => {
    const item = mapPlaylistPanelVideo({
      navigationEndpoint: { watchEndpoint: { videoId: "vid1" } },
      title: { runs: [{ text: "drowned (slowed + reverb)" }] },
      longBylineText: {
        runs: [
          {
            text: "TheGoldenYami",
            navigationEndpoint: nav("UCchan", "MUSIC_PAGE_TYPE_USER_CHANNEL"),
          },
          { text: " • " },
          { text: "10K views" },
        ],
      },
    });
    expect(item?.artists).toEqual([{ id: "UCchan", name: "TheGoldenYami" }]);
    expect(item?.subtitle).toBe("TheGoldenYami");
  });

  it("still links a real artist the same way", () => {
    const item = mapPlaylistPanelVideo({
      navigationEndpoint: { watchEndpoint: { videoId: "vid2" } },
      title: { runs: [{ text: "Song" }] },
      longBylineText: {
        runs: [
          {
            text: "Some Artist",
            navigationEndpoint: nav("UCart", "MUSIC_PAGE_TYPE_ARTIST"),
          },
        ],
      },
    });
    expect(item?.artists).toEqual([{ id: "UCart", name: "Some Artist" }]);
  });
});
