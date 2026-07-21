import { describe, expect, it } from "vitest";
import { extractShuffleEndpoint } from "./playlist";
import type { YtNode } from "./shared";

// Shapes lifted from a real playlist browse header: the Shuffle button's
// watchPlaylistEndpoint params carry the "8gECKAE" shuffle marker, while
// the mix button is a watchPlaylistEndpoint too but with plain "wAEB"
// params and an RDAMPL-prefixed id.
function header(): YtNode {
  return {
    buttons: [
      {
        musicPlayButtonRenderer: {
          playNavigationEndpoint: {
            watchEndpoint: {
              videoId: "abc123",
              playlistId: "PLxyz",
              params: "wAEB",
            },
          },
        },
      },
      {
        menuRenderer: {
          items: [
            {
              menuNavigationItemRenderer: {
                navigationEndpoint: {
                  watchPlaylistEndpoint: {
                    playlistId: "RDAMPLPLxyz",
                    params: "wAEB",
                  },
                },
              },
            },
          ],
          topLevelButtons: [
            {
              buttonRenderer: {
                navigationEndpoint: {
                  watchPlaylistEndpoint: {
                    playlistId: "PLxyz",
                    params: "wAEB8gECKAE%3D",
                  },
                },
              },
            },
          ],
        },
      },
    ],
  };
}

describe("extractShuffleEndpoint", () => {
  it("finds the shuffle watchPlaylistEndpoint by its params marker", () => {
    expect(extractShuffleEndpoint(header())).toEqual({
      playlistId: "PLxyz",
      params: "wAEB8gECKAE%3D",
    });
  });

  it("ignores the mix button and plain watchEndpoints", () => {
    const h = header();
    // Drop the shuffle button, leaving only play + mix endpoints.
    (h.buttons[1].menuRenderer as YtNode).topLevelButtons = [];
    expect(extractShuffleEndpoint(h)).toBeUndefined();
  });

  it("restricts matches to the given playlist id when requireId is set", () => {
    expect(extractShuffleEndpoint(header(), "PLother")).toBeUndefined();
    expect(extractShuffleEndpoint(header(), "PLxyz")).toEqual({
      playlistId: "PLxyz",
      params: "wAEB8gECKAE%3D",
    });
  });

  it("accepts already-decoded params too", () => {
    const h: YtNode = {
      watchPlaylistEndpoint: { playlistId: "LM", params: "wAEB8gECKAE=" },
    };
    expect(extractShuffleEndpoint(h)).toEqual({
      playlistId: "LM",
      params: "wAEB8gECKAE=",
    });
  });
});
