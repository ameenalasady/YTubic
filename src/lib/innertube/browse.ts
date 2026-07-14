import type { Shelf } from "./types";
import {
  collectShelfNodes,
  findContinuationToken,
  mapShelfWrapper,
  rawBrowse,
  rawBrowseContinuation,
  type YtNode,
} from "./shared";

export type BrowsePage = {
  shelves: Shelf[];
  nextCursor?: string;
};

/**
 * Fetch a generic browse feed page — the target of a shelf "More" link
 * that isn't a plain playlist/album: artist discography
 * (`MPAD…` + params), "Playlists by <artist>" (artist browseId + params),
 * etc. Handles both the initial response and grid / section-list
 * continuations.
 */
export async function fetchBrowsePage(
  browseId: string,
  params?: string,
  cursor?: string,
): Promise<BrowsePage> {
  const json = cursor
    ? await rawBrowseContinuation(cursor)
    : await rawBrowse(browseId, params || undefined);

  let shelfNodes: YtNode[] = [];
  if (cursor) {
    const cc = json?.continuationContents;
    if (cc?.gridContinuation?.items) {
      shelfNodes = [{ gridRenderer: { items: cc.gridContinuation.items } }];
      // collectShelfNodes expects section wrappers; feed it the synthetic
      // grid node directly.
      shelfNodes = collectShelfNodes(shelfNodes);
    } else if (cc?.sectionListContinuation?.contents) {
      shelfNodes = collectShelfNodes(cc.sectionListContinuation.contents);
    }
  } else {
    const tabs: YtNode[] =
      json?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? [];
    const sections: YtNode[] =
      tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    shelfNodes = collectShelfNodes(sections);
  }

  const shelves: Shelf[] = [];
  shelfNodes.forEach((wrapper, i) => {
    const { title, items, display, more } = mapShelfWrapper(wrapper, i);
    if (items.length === 0) return;
    shelves.push({
      id: `${cursor ?? "first"}-${title}-${i}`,
      title,
      items,
      display,
      more,
    });
  });

  return { shelves, nextCursor: findContinuationToken(json) };
}
