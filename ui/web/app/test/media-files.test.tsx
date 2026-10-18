/**
 * media-files.test.tsx
 * Up-methods phase 15 in the browser: an uploaded recording plays in a native
 * element that seeks by `currentTime` and whose playhead the page reads
 * ("Now", and the current line following the sound); the needs-transcript
 * panel offers every engine for a recording, with "unknown length" confirmed
 * first; and the dropzone takes audio and video, refusing an oversized file
 * before sending it, and posts to the streaming upload route.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { VideoViewer } from "~/components/reading/video-viewer";
import { NeedsTranscript } from "~/components/reading/needs-transcript";
import { UploadDropzone, uploadAction } from "~/components/knowledge/upload-dropzone";
import { CitationChip } from "~/components/chat/citation-chip";
import {
  ACCEPTED_EXTENSIONS,
  MAX_MEDIA_BYTES,
  MAX_UPLOAD_BYTES,
  isTimed,
  recordingURL,
  uploadLimit,
  type DocumentView,
  type KBDocument,
} from "~/lib/kb-types";

beforeAll(() => {
  initI18n("en");
});

// jsdom has no media pipeline: its currentTime does not move and play() is
// not implemented. The element's clock is kept here instead.
const clock = new WeakMap<HTMLMediaElement, number>();
beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return clock.get(this) ?? 0;
    },
    set(this: HTMLMediaElement, v: number) {
      clock.set(this, v);
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  vi.restoreAllMocks();
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
          const body: Post = { url: new URL(request.url).pathname + new URL(request.url).search };
          for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : `file:${v.name}`;
          posts.push(body);
          return null;
        },
      },
      {
        path: "/knowledge/:kbId/upload",
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = { url: new URL(request.url).pathname + new URL(request.url).search };
          for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : `file:${v.name}`;
          posts.push(body);
          return { uploaded: "x" };
        },
      },
    ],
    { initialEntries: [path.replace(":kbId", "kb-1")] },
  );
  return render(<RouterProvider router={router} />);
}

const recording: KBDocument = {
  id: "doc-m",
  kb_id: "kb-1",
  source_kind: "media",
  title: "Class 3 - rivers.mp3",
  mime: "application/vnd.longplay.transcript+json",
  bytes: 10,
  sha256: "x",
  page_count: 3,
  status: "ready",
  processed_by: { engine: "builtin", model: "Systran/faster-whisper-small" },
  version: 1,
  chunk_count: 1,
  created_at: "",
  updated_at: "",
  media_mime: "audio/mpeg",
  media_bytes: 140323,
  timeline: [
    [0, 4],
    [4, 11],
    [11, 20],
  ],
  transcript_source: "ai_transcript",
};

const pages = [
  { page: 1, markdown: "[00:00] Welcome back to the class." },
  { page: 2, markdown: "[00:04] Today we look at how a river carves a valley." },
  { page: 3, markdown: "[00:11] Start with the water, not the rock." },
];

function audio(): HTMLAudioElement {
  const el = document.querySelector("audio");
  if (!el) throw new Error("no <audio>");
  return el;
}

describe("the media viewer on a recording", () => {
  it("plays the recording from 'self' in an <audio>, from the cited second", () => {
    routed(<VideoViewer document={recording} pages={pages} initialSeconds={11} busy={false} onAsk={() => {}} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(audio().getAttribute("src")).toBe("/documents/doc-m/media");
    expect(audio().currentTime).toBe(11);
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("00:11");
    // Its label names the server's engine and the recording, not a video.
    expect(screen.getByRole("note")).toHaveTextContent(/Whisper small on this server from the recording/);
  });

  it("seeks by currentTime when a transcript line is clicked", async () => {
    routed(<VideoViewer document={recording} pages={pages} initialSeconds={0} busy={false} onAsk={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Play from 00:04/ }));
    expect(audio().currentTime).toBe(4);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("00:04");
  });

  it("follows the playhead, and Now asks about the moment playing", async () => {
    const asks: unknown[] = [];
    routed(
      <VideoViewer
        document={recording}
        pages={pages}
        initialSeconds={0}
        busy={false}
        onAsk={(act, moment) => asks.push({ act, ...moment })}
      />,
    );
    // The sound reaches the third line: it becomes the current one.
    audio().currentTime = 12.4;
    fireEvent.timeUpdate(audio());
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("00:11");

    // Now reads the element itself, to the second.
    audio().currentTime = 15.7;
    await userEvent.click(screen.getByRole("button", { name: "Now" }));
    expect(screen.getByRole("heading", { name: "Ask about 00:15" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(asks).toEqual([{ act: "explain", at: 15, page: 3, text: "Start with the water, not the rock." }]);
  });

  it("plays a video file in a <video>", () => {
    routed(
      <VideoViewer
        document={{ ...recording, media_mime: "video/mp4" }}
        pages={pages}
        initialSeconds={0}
        busy={false}
        onAsk={() => {}}
      />,
    );
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/documents/doc-m/media");
    expect(document.querySelector("audio")).toBeNull();
  });

  it("is a timed document, so a citation to it opens at the cited second", () => {
    expect(isTimed(recording)).toBe(true);
    expect(recordingURL("a b")).toBe("/documents/a%20b/media");
    routed(
      <CitationChip
        index={1}
        source={{ document_id: "doc-m", title: recording.title, page_start: 3, page_end: 3, seconds: 11 } as never}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toContain("t=11");
  });
});

describe("NeedsTranscript on a recording", () => {
  const waiting: KBDocument = {
    ...recording,
    status: "needs_transcript",
    error: "This recording has no transcript yet.",
    processed_by: {},
    transcript_source: undefined,
    timeline: undefined,
    mime: "audio/mpeg",
  };

  it("offers Gemini through the picker, at its audio rate", () => {
    const view: DocumentView = {
      document: waiting,
      transcribe: {
        available: true,
        duration_seconds: 180,
        estimated_tokens: 5760,
        windows: 1,
        free_tier_daily_seconds: 28800,
        engines: [{ engine: "gemini", provider: "gemini", usable: true, downloads: false, estimated_tokens: 5760 }],
      },
    };
    routed(<NeedsTranscript view={view} />);
    expect(screen.getByRole("heading", { name: "This recording needs a transcript" })).toBeInTheDocument();
    expect(screen.getByText(/About 5,760 tokens: 3 min at 32 tokens a second/)).toBeInTheDocument();
    expect(screen.getByText(/deleted from Gemini when the transcript is done/)).toBeInTheDocument();
    // Not the YouTube wording.
    expect(screen.queryByText(/public videos/)).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says unknown length and starts nothing until the learner confirms", async () => {
    const posts: Post[] = [];
    const view: DocumentView = {
      document: waiting,
      transcribe: {
        available: true,
        duration_seconds: 0,
        estimated_tokens: 0,
        windows: 1,
        free_tier_daily_seconds: 28800,
        length_unknown: true,
        engines: [{ engine: "gemini", provider: "gemini", usable: true, downloads: false }],
      },
    };
    routed(<NeedsTranscript view={view} />, posts);
    expect(screen.getByText(/Unknown length/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Your Gemini key/ }));
    const start = screen.getByRole("button", { name: "Transcribe" });
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /transcribe it anyway/ }));
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ intent: "transcribe", engine: "gemini", confirm_unknown_length: "on" });
  });
});

describe("uploading audio and video", () => {
  it("accepts the media extensions, with their own cap", () => {
    for (const ext of [".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".webm", ".mp4", ".mpeg", ".mov"]) {
      expect(ACCEPTED_EXTENSIONS).toContain(ext);
    }
    expect(uploadLimit("Lecture.MOV")).toBe(MAX_MEDIA_BYTES);
    expect(uploadLimit("notes.pdf")).toBe(MAX_UPLOAD_BYTES);
    expect(uploadAction("kb-1", "a b.mp3")).toBe("/knowledge/kb-1/upload?name=a+b.mp3");
  });

  it("posts a recording to the streaming route, and refuses one over 500 MB before sending", async () => {
    const posts: Post[] = [];
    routed(<UploadDropzone kbId="kb-1" />, posts, "/knowledge/:kbId");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toContain(".mp3");

    const big = new File(["x"], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: MAX_MEDIA_BYTES + 1 });
    await userEvent.upload(input, big);
    expect(screen.getByRole("alert")).toHaveTextContent("huge.mp4 is larger than 500 MB");
    expect(posts).toHaveLength(0);

    await userEvent.upload(input, new File(["ID3"], "class.mp3", { type: "audio/mpeg" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    // jsdom's form serialisation loses a File's name, so the route's query
    // string is what carries it; the part itself is a file.
    expect(posts[0]?.url).toBe("/knowledge/kb-1/upload?name=class.mp3");
    expect(posts[0]?.file).toMatch(/^file:/);
  });
});
