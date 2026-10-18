/**
 * feeds-types.ts
 * Podcast feeds and YouTube playlists and channels (up-methods phase 17): the
 * shapes `internal/api/feedapi` returns, and the small pure helpers the feed
 * page renders them with.
 */

export type FeedKind = "podcast" | "youtube";

/** Mirrors internal/knowledge.Feed. */
export type Feed = {
  id: string;
  kb_id: string;
  kind: FeedKind;
  url: string;
  title: string;
  last_checked_at?: string;
  check_error?: string;
  auto_add: boolean;
  /** "feed": the keyless feed; "data_api": the learner's YouTube Data API key. */
  listed_by: "feed" | "data_api";
  created_at: string;
  entries: number;
  new: number;
  added: number;
};

/** Mirrors internal/knowledge.FeedEntry. */
export type FeedEntry = {
  key: string;
  title: string;
  published_at?: string;
  duration_seconds: number;
  media_type?: string;
  media_bytes?: number;
  video_id?: string;
  new: boolean;
  add_status?: "queued" | "failed";
  add_error?: string;
  document_id?: string;
  document_status?: string;
};

/** feedapi's limits. */
export type FeedLimits = {
  max_feeds: number;
  max_pick: number;
  auto_add_per_day: number;
  youtube_feed_limit: number;
  data_api_limit: number;
};

export type FeedsData = { feeds: Feed[]; new: number; limits: FeedLimits };

/** What an entry is now, for its row: in the knowledge base, being added, refused, or pickable. */
export type EntryState = "added" | "queued" | "failed" | "available";

export function entryState(entry: FeedEntry): EntryState {
  if (entry.document_id) return "added";
  if (entry.add_status === "queued") return "queued";
  if (entry.add_status === "failed") return "failed";
  return "available";
}

/** An entry can be ticked unless it is in the knowledge base or on its way. */
export function pickable(entry: FeedEntry): boolean {
  const state = entryState(entry);
  return state === "available" || state === "failed";
}

/** A keyless YouTube feed of a playlist: the one a Data API key lists in full. */
export function isPlaylistFeed(feed: Feed): boolean {
  return feed.kind === "youtube" && feed.url.includes("playlist_id=");
}

/** "1:02:03" or "24:05"; "" when the feed did not say. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** A feed date as a calendar day in the learner's locale ("Oct 13, 2026"); "" when none. */
export function formatDay(iso: string | undefined, locale = "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** What the feed page's action answers. */
export type FeedActionData =
  | { ok: true; intent: string; count?: number }
  | { ok: false; intent: string; errorKey: string; errorDetail: string };
