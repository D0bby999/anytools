/**
 * feeds.test.tsx
 *
 * Podcast feeds and YouTube playlists (up-methods phase 17): "Add a link"
 * answering a feed links to its page; the knowledge base's panel shows what
 * is new; the feed page says what the keyless YouTube feed cannot list, and
 * its picker sends only entries that can still be added.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { AddLink } from "~/components/knowledge/add-link";
import { FeedPanel } from "~/components/knowledge/feed-panel";
import { EntryPicker, FeedControls, FeedNotice } from "~/components/knowledge/feed-entries";
import {
  entryState,
  formatDuration,
  isPlaylistFeed,
  pickable,
  type Feed,
  type FeedEntry,
  type FeedLimits,
} from "~/lib/feeds-types";

beforeAll(() => {
  initI18n("en");
});

const limits: FeedLimits = { max_feeds: 20, max_pick: 20, auto_add_per_day: 5, youtube_feed_limit: 15, data_api_limit: 500 };

const podcast: Feed = {
  id: "f1", kb_id: "kb1", kind: "podcast", url: "https://podcast.example.com/feed.rss", title: "Slow English",
  last_checked_at: "2026-10-16T06:00:00Z", auto_add: false, listed_by: "feed", created_at: "2026-10-16T06:00:00Z",
  entries: 4, new: 3, added: 1,
};
const playlist: Feed = {
  ...podcast, id: "f2", kind: "youtube", title: "Lessons", new: 0,
  url: "https://www.youtube.com/feeds/videos.xml?playlist_id=PLabc1234567",
};

const entries: FeedEntry[] = [
  { key: "k1", title: "Episode 3: Ordering at a café", published_at: "2026-10-13T12:00:00Z", duration_seconds: 1445, new: true },
  { key: "k2", title: "Episode 2: Directions", duration_seconds: 0, new: false },
  { key: "k3", title: "Episode 1: Introductions", duration_seconds: 3723, new: false, document_id: "d1",
    document_status: "needs_transcript" },
  { key: "k4", title: "Episode 0: Pilot", duration_seconds: 60, new: false, add_status: "queued" },
  { key: "k5", title: "Bonus", duration_seconds: 60, new: false, add_status: "failed",
    add_error: "the episode's host answered HTTP 404" },
];

function renderWith(element: ReactElement, posts: [string, string][][], answer: unknown = { ok: true, intent: "add", count: 2 }) {
  const action = async ({ request }: { request: Request }) => {
    posts.push([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
    return answer;
  };
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/feeds/:feedId", action, element: <p>feed page</p> },
      { path: "/knowledge/:kbId", action, element: <p>kb page</p> },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("feed helpers", () => {
  it("formats lengths and reads each entry's state", () => {
    expect(formatDuration(1445)).toBe("24:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(0)).toBe("");
    expect(entries.map(entryState)).toEqual(["available", "available", "added", "queued", "failed"]);
    expect(entries.map(pickable)).toEqual([true, true, false, false, true]);
    expect(isPlaylistFeed(playlist)).toBe(true);
    expect(isPlaylistFeed(podcast)).toBe(false);
  });
});

describe("Add a link", () => {
  it("links to the feed's page when the link was a feed", async () => {
    const posts: [string, string][][] = [];
    renderWith(<AddLink kbId="kb1" />, posts, { feedAdded: { id: "f9", title: "Slow English", entries: 4 } });
    await userEvent.type(screen.getByLabelText("Web page or YouTube video"), "https://podcast.example.com/feed.rss");
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Following “Slow English”: 4 entries to pick from.");
    expect(within(status).getByRole("link", { name: "Open the feed" })).toHaveAttribute("href", "/feeds/f9");
    expect(posts[0]).toContainEqual(["intent", "add-link"]);
    expect(screen.getByText(/a YouTube playlist, channel or @handle/)).toBeInTheDocument();
  });
});

describe("the knowledge base's feeds", () => {
  it("lists each feed with its new count, linking to its page", () => {
    renderWith(<FeedPanel feeds={[podcast, playlist]} />, []);
    expect(screen.getByRole("link", { name: "Slow English" })).toHaveAttribute("href", "/feeds/f1");
    expect(screen.getByText("3 new")).toBeInTheDocument();
    expect(screen.getAllByText(/4 listed · 1 in this knowledge base/)).toHaveLength(2);
  });

  it("says how to add one when there is none", () => {
    renderWith(<FeedPanel feeds={[]} />, []);
    expect(screen.getByText(/Paste a podcast’s RSS link/)).toBeInTheDocument();
  });
});

describe("a feed's page", () => {
  it("says the keyless YouTube feed lists only the latest 15, and how to list a playlist in full", async () => {
    renderWith(<FeedNotice feed={playlist} limits={limits} />, []);
    expect(await screen.findByRole("note")).toHaveTextContent(
      "YouTube’s free feed lists only the latest 15 videos. With your own YouTube Data API key (Settings, Search keys) a playlist lists all its videos, up to 500.",
    );
  });

  it("says nothing of the limit for a channel's Data API hint, a podcast, or a full listing", async () => {
    const channel = { ...playlist, url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw" };
    const { unmount } = renderWith(<FeedNotice feed={channel} limits={limits} />, []);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("only the latest 15 videos");
    expect(note).not.toHaveTextContent("Data API");
    unmount();
    const second = renderWith(<FeedNotice feed={podcast} limits={limits} />, []);
    await screen.findByText(/checks this feed once a day/);
    expect(screen.queryByRole("note")).toBeNull();
    second.unmount();
    renderWith(<FeedNotice feed={{ ...playlist, listed_by: "data_api" }} limits={limits} />, []);
    expect(await screen.findByText(/Listed through your YouTube Data API key/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("ticks only what can still be added and sends those keys", async () => {
    const posts: [string, string][][] = [];
    renderWith(<EntryPicker feedId="f1" entries={entries} limits={limits} />, posts);

    expect(await screen.findByLabelText("Add “Episode 1: Introductions”")).toBeDisabled();
    expect(screen.getByLabelText("Add “Episode 0: Pilot”")).toBeDisabled();
    expect(screen.getByText(/In this knowledge base · waiting for a transcript/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/documents/d1");
    expect(screen.getByText("Not added: the episode's host answered HTTP 404")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    // up's dated list: **date** · title — duration, in the entry's label.
    const dated = screen.getByText("Oct 13, 2026");
    expect(dated.tagName).toBe("STRONG");
    expect(dated.closest("label")).toHaveTextContent("Oct 13, 2026 · Episode 3: Ordering at a café · 24:05");
    expect(screen.getByText("1 entry is being added.")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Tick entries to add" });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Add “Episode 3: Ordering at a café”"));
    await userEvent.click(screen.getByLabelText("Add “Bonus”"));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 selected" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual([
      ["intent", "add"],
      ["entry", "k1"],
      ["entry", "k5"],
    ]);
    // The ticks clear once the entries are on their way.
    await waitFor(() => expect(screen.getByLabelText("Add “Bonus”")).not.toBeChecked());
  });

  it("turns auto_add on from its checkbox", async () => {
    const posts: [string, string][][] = [];
    renderWith(<FeedControls feed={podcast} limits={limits} />, posts, { ok: true, intent: "auto-add" });
    await userEvent.click(await screen.findByLabelText("Add new entries by themselves, at most 5 a day"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual([
      ["intent", "auto-add"],
      ["auto_add", "on"],
    ]);
    expect(screen.getByText(/nothing is transcribed until you choose an engine/)).toBeInTheDocument();
  });
});
