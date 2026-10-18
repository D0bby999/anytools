/**
 * feeds.server.ts
 * Podcast feeds and YouTube playlists and channels (up-methods phase 17): the
 * thin API module. Server-side only; every call takes the user id
 * explicitly, as kb.server.ts does. A feed is ADDED through "Add a link"
 * (kb.server `addLink`), which answers a feed instead of a document.
 */
import { apiFetch } from "~/lib/api.server";
import type { Feed, FeedEntry, FeedLimits, FeedsData } from "~/lib/feeds-types";

const feedPath = (id: string) => `/v1/feeds/${encodeURIComponent(id)}`;

export function listFeeds(userId: string, kbId: string) {
  return apiFetch<FeedsData>(`/v1/kb/${encodeURIComponent(kbId)}/feeds`, userId);
}

export function getFeed(userId: string, feedId: string) {
  return apiFetch<{ feed: Feed; entries: FeedEntry[]; limits: FeedLimits }>(feedPath(feedId), userId);
}

export function checkFeed(userId: string, feedId: string) {
  return apiFetch<{ feed: Feed; new: number }>(`${feedPath(feedId)}/check`, userId, { method: "POST", body: {} });
}

export function addFeedEntries(userId: string, feedId: string, entries: string[]) {
  return apiFetch<{ job_id: string; queued: string[] }>(`${feedPath(feedId)}/entries`, userId, {
    method: "POST",
    body: { entries },
  });
}

export function markFeedSeen(userId: string, feedId: string) {
  return apiFetch<void>(`${feedPath(feedId)}/seen`, userId, { method: "POST", body: {} });
}

export function setFeedAutoAdd(userId: string, feedId: string, autoAdd: boolean) {
  return apiFetch<{ feed: Feed }>(feedPath(feedId), userId, { method: "PATCH", body: { auto_add: autoAdd } });
}

export function deleteFeed(userId: string, feedId: string) {
  return apiFetch<void>(feedPath(feedId), userId, { method: "DELETE" });
}
