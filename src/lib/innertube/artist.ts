import type { ArtistPage, Shelf, WatchTarget } from "./types";
import {
  collectShelfNodes,
  innertubePost,
  mapShelfWrapper,
  rawBrowse,
  readRuns,
  readThumbnails,
  type YtNode,
} from "./shared";

/**
 * Read a header button's watch target. Both header buttons (Shuffle /
 * Mix) ship a `watchEndpoint` carrying a seed videoId plus the watch
 * playlist (`RDAO…` / `RDEM…`); older payloads used a bare
 * `watchPlaylistEndpoint`.
 */
function readWatchTarget(button: YtNode | undefined): WatchTarget | undefined {
  const ep = button?.buttonRenderer?.navigationEndpoint;
  const videoId: string | undefined = ep?.watchEndpoint?.videoId;
  const playlistId: string | undefined =
    ep?.watchEndpoint?.playlistId ?? ep?.watchPlaylistEndpoint?.playlistId;
  if (!videoId && !playlistId) return undefined;
  return { videoId, playlistId };
}

export async function fetchArtist(id: string): Promise<ArtistPage> {
  const json = await rawBrowse(id);

  const header =
    json?.header?.musicImmersiveHeaderRenderer ??
    json?.header?.musicDetailHeaderRenderer ??
    {};

  const name = readRuns(header.title);
  const description = readRuns(header.description);
  const subscribeButton =
    header.subscriptionButton?.subscribeButtonRenderer ?? {};
  const subscribers = readRuns(subscribeButton.subscriberCountText);
  // The official web header shows "241M monthly audience" here, not the
  // subscriber count — mirror that.
  const monthlyAudience = readRuns(header.monthlyListenerCount);
  const thumbnails = readThumbnails(
    header.thumbnail?.musicThumbnailRenderer?.thumbnail ??
      header.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail ??
      header.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail,
  );

  // Header buttons: `playButton` is Shuffle (RDAO… watch playlist),
  // `startRadioButton` is Mix (RDEM…).
  const shuffle = readWatchTarget(header.playButton);
  const mix = readWatchTarget(header.startRadioButton);

  const tabs: YtNode[] =
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? [];
  const sections: YtNode[] =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const shelfNodes = collectShelfNodes(sections);

  const shelves: Shelf[] = [];
  shelfNodes.forEach((wrapper, i) => {
    const { title, items, display, more } = mapShelfWrapper(wrapper, i);
    if (items.length === 0) return;
    shelves.push({ id: `${title}-${i}`, title, items, display, more });
  });

  return {
    id,
    name,
    description: description || undefined,
    monthlyAudience: monthlyAudience || undefined,
    subscribers: subscribers || undefined,
    channelId: subscribeButton.channelId || undefined,
    subscribed:
      typeof subscribeButton.subscribed === "boolean"
        ? subscribeButton.subscribed
        : undefined,
    thumbnails,
    shuffle,
    mix,
    shelves,
  };
}

/**
 * Toggle the artist-channel subscription. Requires a signed-in session —
 * the shared innertubePost attaches SAPISIDHASH auth automatically; an
 * anonymous call gets a 401 which surfaces as a thrown Error.
 */
export async function setArtistSubscribed(
  channelId: string,
  subscribed: boolean,
): Promise<void> {
  await innertubePost(
    subscribed ? "subscription/subscribe" : "subscription/unsubscribe",
    { channelIds: [channelId] },
  );
}
