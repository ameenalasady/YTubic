import { describe, expect, it } from "vitest";
import { classifyAllRow, extractCardAction, mapTopResultCard } from "./search";
import type { YtNode } from "./shared";

// Minimal builders mirroring the real InnerTube shapes observed on the "all"
// search tab (top-result musicCardShelfRenderer + flat
// musicResponsiveListItemRenderer rows).

function row(
  token: string,
  opts: {
    videoId?: string;
    browseId?: string;
    pageType?: string;
    title?: string;
  },
): YtNode {
  const titleRun: YtNode = { text: opts.title ?? "Title" };
  if (opts.videoId) {
    titleRun.navigationEndpoint = { watchEndpoint: { videoId: opts.videoId } };
  }
  const mrli: YtNode = {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [titleRun] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: token }, { text: " • detail" }] },
        },
      },
    ],
  };
  if (opts.browseId) {
    mrli.navigationEndpoint = {
      browseEndpoint: {
        browseId: opts.browseId,
        browseEndpointContextSupportedConfigs: {
          browseEndpointContextMusicConfig: { pageType: opts.pageType },
        },
      },
    };
  }
  return mrli;
}

describe("classifyAllRow", () => {
  it("buckets a song by its subtitle token", () => {
    const r = classifyAllRow(row("Song", { videoId: "vid123" }));
    expect(r).not.toBeNull();
    expect(r?.group).toBe("song");
    expect(r?.item.kind).toBe("song");
    expect(r?.item.id).toBe("vid123");
  });

  it("re-kinds a video row (mapper defaults watch rows to song)", () => {
    const r = classifyAllRow(row("Video", { videoId: "vidABC" }));
    expect(r?.group).toBe("video");
    expect(r?.item.kind).toBe("video");
    expect(r?.item.id).toBe("vidABC");
  });

  it("maps albums and treats Single / EP as albums", () => {
    for (const token of ["Album", "Single", "EP"]) {
      const r = classifyAllRow(
        row(token, { browseId: "MPREb_x", pageType: "MUSIC_PAGE_TYPE_ALBUM" }),
      );
      expect(r?.group).toBe("album");
      expect(r?.item.kind).toBe("album");
      expect(r?.item.id).toBe("MPREb_x");
    }
  });

  it("maps artist rows as round artist items", () => {
    const r = classifyAllRow(
      row("Artist", { browseId: "UC_x", pageType: "MUSIC_PAGE_TYPE_ARTIST" }),
    );
    expect(r?.group).toBe("artist");
    expect(r?.item.kind).toBe("artist");
    expect(r?.item.round).toBe(true);
  });

  it("maps community playlists", () => {
    const r = classifyAllRow(
      row("Playlist", {
        browseId: "VLPL_x",
        pageType: "MUSIC_PAGE_TYPE_PLAYLIST",
      }),
    );
    expect(r?.group).toBe("playlist");
    expect(r?.item.kind).toBe("playlist");
  });

  it('maps a plain channel ("Profile") to the artist page', () => {
    // An uploader of remixes / slowed versions has no albums or singles and
    // is not a YT Music artist, but its channel page opens fine as one.
    const r = classifyAllRow(
      row("Profile", {
        browseId: "UC_p",
        pageType: "MUSIC_PAGE_TYPE_USER_CHANNEL",
      }),
    );
    expect(r?.group).toBe("artist");
    expect(r?.item.kind).toBe("artist");
    expect(r?.item.id).toBe("UC_p");
    expect(r?.item.round).toBe(true);
  });

  it("skips types the app has no destination for", () => {
    expect(
      classifyAllRow(
        row("Episode", {
          videoId: "ep1",
          browseId: "MPED1",
          pageType: "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE",
        }),
      ),
    ).toBeNull();
    expect(
      classifyAllRow(
        row("Podcast", {
          browseId: "MPSP1",
          pageType: "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE",
        }),
      ),
    ).toBeNull();
  });
});

function card(opts: {
  title: string;
  subtitle: string;
  onTap: YtNode;
}): YtNode {
  return {
    title: { runs: [{ text: opts.title, navigationEndpoint: opts.onTap }] },
    subtitle: { runs: [{ text: opts.subtitle }] },
    onTap: opts.onTap,
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [{ url: "http://x/y.jpg", width: 60, height: 60 }],
        },
      },
    },
  };
}

describe("mapTopResultCard", () => {
  it("extracts an artist entity from a browse onTap (was lost → 'Section 1')", () => {
    const item = mapTopResultCard(
      card({
        title: "The Weeknd",
        subtitle: "Artist • 224M monthly audience",
        onTap: {
          browseEndpoint: {
            browseId: "UClYV6hHlupm",
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: {
                pageType: "MUSIC_PAGE_TYPE_ARTIST",
              },
            },
          },
        },
      }),
    );
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("artist");
    expect(item?.id).toBe("UClYV6hHlupm");
    expect(item?.title).toBe("The Weeknd");
    expect(item?.round).toBe(true);
    expect(item?.thumbnails.length).toBe(1);
  });

  it("extracts an album entity from a browse onTap", () => {
    const item = mapTopResultCard(
      card({
        title: "Trilogy",
        subtitle: "Album • The Weeknd",
        onTap: {
          browseEndpoint: {
            browseId: "MPREb_DbmffDiBz16",
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: {
                pageType: "MUSIC_PAGE_TYPE_ALBUM",
              },
            },
          },
        },
      }),
    );
    expect(item?.kind).toBe("album");
    expect(item?.id).toBe("MPREb_DbmffDiBz16");
  });

  it("extracts a song entity from a watch onTap", () => {
    const item = mapTopResultCard(
      card({
        title: "Blinding Lights",
        subtitle: "Song • The Weeknd",
        onTap: { watchEndpoint: { videoId: "4NRXx6U8ABQ" } },
      }),
    );
    expect(item?.kind).toBe("song");
    expect(item?.id).toBe("4NRXx6U8ABQ");
  });

  it("distinguishes a music-video top result via its subtitle token", () => {
    const item = mapTopResultCard(
      card({
        title: "Blinding Lights (Official Video)",
        subtitle: "Video • The Weeknd • 1B views",
        onTap: { watchEndpoint: { videoId: "4NRXx6U8ABQ" } },
      }),
    );
    expect(item?.kind).toBe("video");
  });
});

describe("extractCardAction", () => {
  it("reads an artist Shuffle button (watch-playlist radio)", () => {
    const action = extractCardAction({
      buttons: [
        {
          buttonRenderer: {
            text: { runs: [{ text: "Shuffle" }] },
            icon: { iconType: "MUSIC_SHUFFLE" },
            command: { watchPlaylistEndpoint: { playlistId: "RDAO_xyz" } },
          },
        },
        {
          buttonRenderer: {
            text: { runs: [{ text: "Mix" }] },
            command: { watchPlaylistEndpoint: { playlistId: "RDEM_xyz" } },
          },
        },
      ],
    });
    expect(action).toEqual({
      label: "Shuffle",
      kind: "shuffle",
      videoId: undefined,
      playlistId: "RDAO_xyz",
    });
  });

  it("reads a song Play button (direct watch)", () => {
    const action = extractCardAction({
      buttons: [
        {
          buttonRenderer: {
            text: { runs: [{ text: "Play" }] },
            command: { watchEndpoint: { videoId: "vid123" } },
          },
        },
      ],
    });
    expect(action?.kind).toBe("play");
    expect(action?.videoId).toBe("vid123");
    expect(action?.playlistId).toBeUndefined();
  });

  it("returns undefined when the card has no actionable button", () => {
    expect(extractCardAction({})).toBeUndefined();
    expect(
      extractCardAction({
        buttons: [{ buttonRenderer: { text: { runs: [] } } }],
      }),
    ).toBeUndefined();
  });
});
