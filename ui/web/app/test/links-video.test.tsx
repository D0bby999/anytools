/**
 * links-video.test.tsx
 * Learning-depth phase 4 in the browser: "Add a link", the video viewer (a
 * plain nocookie iframe that seeks by resetting its src), the needs-transcript
 * panel with the cost shown before transcribing, and the citation chip that
 * opens a video at the cited second.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { AddLink } from "~/components/knowledge/add-link";
import { VideoViewer } from "~/components/reading/video-viewer";
import { NeedsTranscript } from "~/components/reading/needs-transcript";
import { CitationChip } from "~/components/chat/citation-chip";
import {
  embedURL,
  formatClock,
  pageAtSeconds,
  thumbnailURL,
  transcriptText,
  type DocumentView,
  type KBDocument,
} from "~/lib/kb-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[] = [], path = "/") {
  const router = createMemoryRouter(
    [
      {
        path,
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = {};
          for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : `file:${v.name}`;
          posts.push(body);
          return null;
        },
      },
    ],
    { initialEntries: [path.replace(":kbId", "kb-1")] },
  );
  return render(<RouterProvider router={router} />);
}

const video: KBDocument = {
  id: "doc-v",
  kb_id: "kb-1",
  source_kind: "youtube",
  title: "Me at the zoo",
  mime: "application/vnd.longplay.transcript+json",
  bytes: 10,
  sha256: "x",
  page_count: 3,
  status: "ready",
  processed_by: {},
  version: 1,
  chunk_count: 1,
  created_at: "",
  updated_at: "",
  source_url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  media_id: "jNQXAC9IVRw",
  timeline: [
    [0, 25],
    [25, 90],
    [754, 800],
  ],
  transcript_source: "captions",
};

const pages = [
  { page: 1, markdown: "[00:00] All right, so here we are &amp; the elephants" },
  { page: 2, markdown: "[00:25] They have really long trunks &lt;b&gt;" },
  { page: 3, markdown: "[12:34] And that's pretty much all there is to say" },
];

describe("kb-types helpers", () => {
  it("formats clocks, maps seconds to pages and refuses a forged id", () => {
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(pageAtSeconds(video, 30)).toBe(2);
    expect(pageAtSeconds(video, 760)).toBe(3);
    expect(embedURL("jNQXAC9IVRw", 30.9)).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=30&rel=0");
    expect(embedURL("jNQXAC9IVRw/../../x", 0)).toBeNull();
    expect(embedURL('"><script>', 0)).toBeNull();
    expect(thumbnailURL("jNQXAC9IVRw")).toBe("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg");
    expect(transcriptText("a &lt;b&gt; &amp;lt; c")).toBe("a <b> &lt; c");
  });
});

describe("AddLink", () => {
  it("posts the URL and the auto-sync choice", async () => {
    const posts: Post[] = [];
    routed(<AddLink kbId="kb-1" />, posts, "/knowledge/:kbId");
    await userEvent.type(screen.getByLabelText("Web page or YouTube video"), "https://example.com/notes");
    await userEvent.click(screen.getByRole("checkbox", { name: /Check this page daily/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ intent: "add-link", url: "https://example.com/notes", auto_sync: "on" });
  });
});

describe("VideoViewer", () => {
  it("plays through the nocookie player from the cited second and seeks by resetting src", async () => {
    const asks: unknown[] = [];
    routed(
      <VideoViewer
        document={video}
        pages={pages}
        initialSeconds={754}
        busy={false}
        onAsk={(act, moment) => asks.push({ act, ...moment })}
      />,
    );
    const frame = screen.getByTitle("Video player: Me at the zoo");
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=754&rel=0");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");

    // The cited line is current; entities are text, never markup.
    const current = screen.getByRole("button", { current: true });
    expect(current).toHaveTextContent("12:34");
    expect(screen.getByText("They have really long trunks <b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Play from 00:25/ }));
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=25&rel=0&autoplay=1",
    );
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("00:25");

    // The tutor is asked about the chosen moment.
    expect(screen.getByRole("heading", { name: "Ask about 00:25" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(asks).toEqual([{ act: "explain", at: 25, page: 2, text: "They have really long trunks <b>" }]);
  });

  it("labels an AI transcript", () => {
    routed(
      <VideoViewer
        document={{ ...video, transcript_source: "ai_transcript" }}
        pages={pages}
        initialSeconds={0}
        busy={false}
        onAsk={() => {}}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/AI transcript.*misheard/);
  });

  it("shows an untimed transcript as text and cannot seek", () => {
    routed(
      <VideoViewer
        document={{ ...video, timeline: undefined }}
        pages={[{ page: 1, markdown: "Just words." }]}
        initialSeconds={0}
        busy={false}
        onAsk={() => {}}
      />,
    );
    expect(screen.getByText(/no timestamps/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play from/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
  });
});

describe("NeedsTranscript", () => {
  const blocked: KBDocument = {
    ...video,
    status: "needs_transcript",
    error: "YouTube did not let this server read the captions.",
    timeline: undefined,
    transcript_source: undefined,
    media: { duration_seconds: 600, tracks: [{ lang: "en", name: "English" }] },
  };

  it("shows the cost and the limits before transcribing, and posts each way", async () => {
    const posts: Post[] = [];
    const view: DocumentView = {
      document: blocked,
      transcribe: {
        available: true,
        duration_seconds: 600,
        estimated_tokens: 60000,
        windows: 1,
        free_tier_daily_seconds: 28800,
      },
    };
    routed(<NeedsTranscript view={view} />, posts);
    expect(screen.getByText(/did not let this server read the captions/)).toBeInTheDocument();
    expect(screen.getByText("About 60,000 tokens: 10 min at 100 tokens a second.")).toBeInTheDocument();
    expect(screen.getByText(/up to 8 hours of YouTube video a day/)).toBeInTheDocument();
    expect(screen.getByText(/Only public videos/)).toBeInTheDocument();
    // Decorative (alt=""), so not in the accessibility tree; built from the id.
    expect(document.querySelector("img")).toHaveAttribute("src", "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg");

    await userEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ intent: "transcribe" });

    await userEvent.type(screen.getByRole("textbox", { name: "Paste the transcript" }), "[[00:05] hello");
    await userEvent.click(screen.getByRole("button", { name: "Use this transcript" }));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ intent: "transcript-paste", text: "[00:05] hello" });

    // The subtitle upload is a multipart form carrying the file as "file",
    // the part kbapi reads. (Submitting a jsdom File through the memory
    // router's multipart request does not complete in this environment; the
    // server side of the upload is covered by internal/knowledge and
    // internal/app's end-to-end tests.)
    const picker = screen.getByLabelText<HTMLInputElement>("Upload subtitles", { selector: "input" });
    expect(picker).toHaveAttribute("name", "file");
    expect(picker).toHaveAttribute("accept", ".vtt,.srt");
    const uploadForm = picker.closest("form");
    expect(uploadForm).toHaveAttribute("enctype", "multipart/form-data");
    expect(uploadForm?.querySelector('input[name="intent"]')).toHaveAttribute("value", "transcript-upload");
  });

  it("without a Gemini key on the parse route, offers upload and paste and points to Settings", () => {
    routed(
      <NeedsTranscript
        view={{
          document: blocked,
          transcribe: { available: false, duration_seconds: 0, estimated_tokens: 0, windows: 1, free_tier_daily_seconds: 28800 },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "Use this transcript" })).toBeInTheDocument();
  });
});

describe("NeedsTranscript replacing a ready transcript", () => {
  it("offers subtitles and paste but never re-transcribes", () => {
    routed(<NeedsTranscript view={{ document: video }} replacing />);
    expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();
    expect(screen.queryByText("This video needs a transcript")).toBeNull();
    expect(screen.getByRole("button", { name: "Use this transcript" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });
});

describe("CitationChip for a video", () => {
  it("shows Title · MM:SS and opens the player at that second", () => {
    routed(
      <CitationChip
        index={2}
        source={{ kind: "chunk", id: "c9", title: "Me at the zoo", page: 3, document_id: "doc-v", seconds: 754 }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/documents/doc-v?page=3&t=754");
    expect(link).toHaveTextContent("Me at the zoo· 12:34");
    expect(link).toHaveAccessibleName("Open Me at the zoo at 12:34");
  });

  it("says when the passage is from an AI transcript", () => {
    routed(
      <CitationChip
        index={1}
        source={{ kind: "chunk", id: "c1", title: "Talk", page: 1, document_id: "d", seconds: 0, ai_transcript: true }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("AI transcript");
    expect(link).toHaveAccessibleName("Open Talk at 00:00 (AI transcript)");
  });
});
