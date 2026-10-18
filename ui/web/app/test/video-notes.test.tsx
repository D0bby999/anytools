/**
 * video-notes.test.tsx
 * A video's study notes beside its player: sections whose times seek the
 * player, written only when the learner asks and in the language they pick;
 * the creator's chapters heading the transcript; the description and the
 * caption provenance shown as text.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { VideoViewer } from "~/components/reading/video-viewer";
import type { KBDocument } from "~/lib/kb-types";
import type { VideoNotes } from "~/lib/video-notes-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[] = []) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = {};
          for (const [k, v] of form.entries()) body[k] = String(v);
          posts.push(body);
          return { notesMade: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const video: KBDocument = {
  id: "doc-v",
  kb_id: "kb-1",
  source_kind: "youtube",
  title: "Markets",
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
    [0, 60],
    [60, 120],
    [120, 200],
  ],
  transcript_source: "captions",
  media: {
    language: "en",
    auto_captions: true,
    description: "Links: <a href=x>here</a>\n0:00 Intro",
    chapters: [
      { start: 0, end: 60, title: "Intro" },
      { start: 60, end: 200, title: "Supply <i>and</i> demand" },
    ],
  },
};

const pages = [
  { page: 1, markdown: "[00:00] Welcome" },
  { page: 2, markdown: "[01:00] Supply rises" },
  { page: 3, markdown: "[02:00] Demand falls" },
];

const notes: VideoNotes[] = [
  {
    id: "n-en",
    document_id: "doc-v",
    language: "en",
    from_chapters: true,
    model: "model-x",
    created_at: "",
    stale: false,
    sections: [
      { start: 0, end: 60, title: "Intro", summary: "What the course covers.", points: [] },
      {
        start: 60,
        end: 200,
        title: "Supply and demand",
        summary: "Prices <img src=x onerror=alert(1)> meet.",
        points: [
          { text: "Supply rises with price", at: 125 },
          { text: "A point with no time" },
        ],
      },
    ],
  },
  {
    id: "n-vi",
    document_id: "doc-v",
    language: "vi",
    from_chapters: false,
    model: "model-x",
    created_at: "",
    stale: true,
    sections: [{ start: 0, end: 200, title: "Tổng quan", summary: "Cung và cầu.", points: [] }],
  },
];

const viewer = (n: VideoNotes[]) => (
  <VideoViewer document={video} pages={pages} notes={n} initialSeconds={0} busy={false} onAsk={() => {}} />
);

describe("VideoViewer's study notes", () => {
  it("shows the notes first, and every time in them seeks the player", async () => {
    routed(viewer(notes));
    const frame = screen.getByTitle("Video player: Markets");
    expect(screen.getByRole("tab", { name: "Study notes" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Study notes" });

    // Model text is text: the markup in a summary is not an element.
    expect(within(panel).getByText("Prices <img src=x onerror=alert(1)> meet.")).toBeInTheDocument();
    expect(panel.querySelector("img")).toBeNull();
    expect(within(panel).getByText(/one section per chapter/)).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Play from 02:05" }));
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=125&rel=0&autoplay=1");
    // The moment to ask the tutor about follows the seek.
    expect(screen.getByRole("heading", { name: "Ask about 02:00" })).toBeInTheDocument();
    // A point without a time has no seek button.
    expect(within(panel).getByText("A point with no time").querySelector("button")).toBeNull();

    const download = within(panel).getByRole("link", { name: "Download as Markdown" });
    expect(download).toHaveAttribute("href", "/documents/doc-v/study-notes.md?language=en");

    // The other language's notes, written before the transcript changed.
    await userEvent.click(within(panel).getByRole("button", { name: "Vietnamese" }));
    expect(within(panel).getByText("Tổng quan")).toBeInTheDocument();
    expect(within(panel).getByText(/The transcript changed/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Download as Markdown" })).toHaveAttribute(
      "href",
      "/documents/doc-v/study-notes.md?language=vi",
    );
  });

  it("writes notes only when asked, in the language picked", async () => {
    const posts: Post[] = [];
    routed(viewer([]), posts);
    // Without notes the transcript is shown first; nothing is written.
    expect(screen.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
    expect(posts).toHaveLength(0);

    await userEvent.click(screen.getByRole("tab", { name: "Study notes" }));
    expect(screen.getByText(/the video is not downloaded/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Language"), "vi");
    await userEvent.click(screen.getByRole("button", { name: "Write study notes" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ intent: "study-notes", language: "vi" });
  });

  it("heads the transcript with the creator's chapters and says whose captions it is", async () => {
    routed(viewer([]));
    const frame = screen.getByTitle("Video player: Markets");
    const panel = screen.getByRole("tabpanel", { name: "Transcript" });
    expect(within(panel).getByText(/auto-generated captions/)).toBeInTheDocument();

    const rows = within(panel).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Intro");
    expect(rows[1]).toHaveTextContent("Supply <i>and</i> demand");
    // A chapter heads only the first line inside it.
    expect(within(rows[2]!).getAllByRole("button")).toHaveLength(1);
    expect(panel.querySelector("i")).toBeNull();

    await userEvent.click(within(rows[1]!).getByRole("button", { name: /Supply <i>and<\/i> demand/ }));
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=60&rel=0&autoplay=1");

    // The creator's description is plain text.
    expect(screen.getByText(/Links: <a href=x>here<\/a>/)).toBeInTheDocument();
    expect(document.querySelector("a[href='x']")).toBeNull();
  });
});
