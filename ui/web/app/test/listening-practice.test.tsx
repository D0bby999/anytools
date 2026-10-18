/**
 * listening-practice.test.tsx
 * Up-methods phase 2: "Practise listening" on a video. The listening audit's
 * scaffold ladder decides what the page shows: at stages 1, 2 and 5 the
 * Transcript and Study notes tabs, the questions about a moment and the tutor
 * are away (on an untimed video, the whole transcript section), and they come
 * back at stage 3 and once stage 5 is done; the transcript is away while the
 * retelling is written. A timestamp's Play seeks with start and end, Now fills
 * in the chosen moment, and §7's delayed shadow is recorded beside "Play
 * segment". MediaRecorder and the microphone are mocked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { embedURL, parseClock, type KBDocument } from "~/lib/kb-types";
import {
  currentStage,
  listeningView,
  markedDoneKey,
  segmentRange,
  transcriptVisible,
} from "~/lib/ladder";
import { VideoViewer } from "~/components/reading/video-viewer";
import type { ListeningData } from "~/components/reading/listening-practice";
import type { Answers, Recording, TableRow, WorksheetKind } from "~/lib/worksheet-types";
import DocumentViewer from "~/routes/documents.$docId";

beforeAll(() => {
  initI18n("en");
});

// ─────────────────────────────────────────────────────────────── ladder.ts

const filled = (...stages: number[]): TableRow[] =>
  stages.map((n) => ({ row: `stage${n}`, cells: { visible: `stage ${n} showed something` } }));

describe("ladder.ts", () => {
  it("keeps the transcript away at stages 1, 2 and 5 only", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(transcriptVisible)).toEqual([false, false, true, true, false, true, true]);
  });

  it("is at the first stage whose 'what became visible' is empty, or past the last one marked done", () => {
    expect(currentStage([])).toBe(1);
    expect(currentStage(filled(1))).toBe(2);
    expect(currentStage(filled(1, 2))).toBe(3);
    expect(currentStage(filled(1, 2, 4))).toBe(3);
    expect(currentStage(filled(1, 2, 3, 4))).toBe(5);
    expect(currentStage(filled(1, 2, 3, 4, 5, 6))).toBe(7);
    expect(currentStage([{ row: "stage1", cells: { visible: "   ", unproven: "x" } }])).toBe(1);
    // Marking stage 5 done moves past it; an older mark does not move back.
    expect(currentStage(filled(1, 2, 3, 4), 5)).toBe(6);
    expect(currentStage(filled(1, 2, 3, 4), 2)).toBe(5);
    expect(currentStage([], 9)).toBe(7);
  });

  it("hides nothing without an audit, and hides the transcript while the retelling is written", () => {
    expect(listeningView(null)).toEqual({ stage: 0, hidden: null });
    expect(listeningView([])).toEqual({ stage: 1, hidden: "stage" });
    expect(listeningView(filled(1, 2))).toEqual({ stage: 3, hidden: null });
    expect(listeningView(filled(1, 2), 0, true)).toEqual({ stage: 3, hidden: "retelling" });
    expect(listeningView(filled(1, 2, 3, 4), 0, true)).toEqual({ stage: 5, hidden: "stage" });
  });

  it("replays to the segment's end, or 20 seconds on", () => {
    expect(segmentRange(65)).toEqual({ start: 65, end: 85 });
    expect(segmentRange(65, 75)).toEqual({ start: 65, end: 75 });
    expect(segmentRange(65, 60)).toEqual({ start: 65, end: 85 });
  });

  it("reads MM:SS and H:MM:SS, as the API's Check does", () => {
    expect(parseClock("01:05")).toBe(65);
    expect(parseClock("75:00")).toBe(4500);
    expect(parseClock("1:02:03")).toBe(3723);
    for (const bad of ["1:5", "12:60", "1:2:03", "90", "", "1h"]) expect(parseClock(bad)).toBeNull();
  });

  it("stops the player with end= only after start", () => {
    expect(embedURL("jNQXAC9IVRw", 65, true, 85)).toBe(
      "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=65&rel=0&end=85&autoplay=1",
    );
    expect(embedURL("jNQXAC9IVRw", 65, false, 60)).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=65&rel=0");
  });
});

// ──────────────────────────────────────────────────────────────── the page

// The parts of the served listening_audit kind this page relies on
// (internal/learning/worksheet/kinds_listening_audit.go; the Go test
// TestTheVideoPageFindsItsFields pins these keys).
const stageText = {
  stage1: "Listen once with no captions",
  stage2: "Replay only the 5–20 second segment that went wrong",
  stage3: "Open the English transcript to check boundaries and structure",
  stage4: "Look up the least you need",
  stage5: "Close the text and listen again at normal speed",
  stage6: "Retest on parallel material",
};
const auditKind: WorksheetKind = {
  kind: "listening_audit",
  name: "Listening audit",
  group: "language",
  source: "docs/en/templates/listening-audit.md",
  summary: "",
  private: false,
  attach: "document",
  document_kinds: ["youtube"],
  version: 1,
  sections: [
    {
      key: "errors",
      title: "Six-layer error map",
      fields: [
        {
          key: "map",
          label: "Error map",
          type: "table",
          max_rows: 30,
          columns: [
            { key: "timestamp", label: "Timestamp", type: "text" },
            { key: "heard", label: "I thought I heard", type: "text" },
          ],
        },
      ],
    },
    {
      key: "ladder",
      title: "Scaffold ladder",
      fields: [
        {
          key: "stages",
          label: "Stages",
          type: "table",
          row_header: "Stage",
          rows: [1, 2, 3, 4, 5, 6].map((n) => ({ key: `stage${n}`, label: String(n) })),
          columns: [
            { key: "action", label: "Action", type: "label", text: stageText },
            { key: "visible", label: "What became visible", type: "text" },
            { key: "unproven", label: "What is still unproven", type: "text" },
          ],
        },
      ],
    },
    {
      key: "segment",
      title: "From dictation and shadowing to your own words",
      fields: [
        { key: "start", label: "High-impact segment: start", type: "text" },
        { key: "end", label: "High-impact segment: end", type: "text" },
        { key: "shadow", label: "Delayed-shadow recording", type: "audio" },
        { key: "retelling", label: "Retelling with the text closed", type: "long" },
      ],
    },
  ],
};

const take = (id: string): Recording => ({
  id,
  worksheet_id: "w1",
  mime: "audio/webm",
  bytes: 10,
  duration_seconds: 11,
  created_at: "2026-10-16T08:00:00Z",
});

function listeningData(answers: Answers, recordings: Recording[] = []): ListeningData {
  return {
    audit: {
      worksheet: {
        id: "w1",
        kind: "listening_audit",
        kind_version: 1,
        title: "Listening audit: Me at the zoo",
        answers,
        document_id: "doc-v",
        status: "open",
        private: false,
        reviews: {},
        recordings,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
      },
      kind: auditKind,
      earlier: [],
    },
    audits: [],
    experiments: [],
  };
}

const ladderAt = (...stages: number[]): Answers => ({ ladder: { stages: filled(...stages) } });

const video: KBDocument = {
  id: "doc-v",
  kb_id: "kb-1",
  source_kind: "youtube",
  title: "Me at the zoo",
  mime: "application/vnd.longplay.transcript+json",
  bytes: 10,
  sha256: "x",
  page_count: 2,
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
  ],
  transcript_source: "captions",
};
const pages = [
  { page: 1, markdown: "[00:00] All right, so here we are" },
  { page: 2, markdown: "[00:25] They have really long trunks" },
];

type Post = { url: string; fields: Record<string, string> };

function inRouter(el: ReactElement, posts: Post[] = []) {
  const record = async ({ request }: { request: Request }) => {
    const form = await request.formData();
    posts.push({ url: new URL(request.url).pathname, fields: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) });
    const section = String(form.get("section") ?? "");
    return section ? { section, ok: true, revision: "2026-10-16T00:00:01Z" } : null;
  };
  const router = createMemoryRouter(
    [
      { path: "/documents/:docId", element: el, action: record },
      { path: "/toolkit/:id", element: null, action: record },
    ],
    { initialEntries: ["/documents/doc-v"] },
  );
  return render(<RouterProvider router={router} />);
}

function viewer(
  data: ListeningData | undefined,
  opts: { doc?: KBDocument; pages?: typeof pages; seconds?: number; onHidden?: (h: boolean) => void } = {},
) {
  const posts: Post[] = [];
  inRouter(
    <VideoViewer
      document={opts.doc ?? video}
      pages={opts.pages ?? pages}
      initialSeconds={opts.seconds ?? 0}
      busy={false}
      onAsk={() => {}}
      listening={data}
      onTranscriptHidden={opts.onHidden}
    />,
    posts,
  );
  return posts;
}

const frameSrc = () => screen.getByTitle("Video player: Me at the zoo").getAttribute("src");

beforeEach(() => {
  window.localStorage.clear();
});

describe("Practise listening: the ladder controls the transcript", () => {
  it("at stage 1 has no Transcript or Study notes tab, no questions for the tutor, and says why", () => {
    const hidden = vi.fn();
    viewer(listeningData({}), { onHidden: hidden });
    expect(screen.queryByRole("tab", { name: "Transcript" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Study notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Practise listening" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Explain" })).not.toBeInTheDocument();
    expect(screen.queryByText("They have really long trunks")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Ladder stage 1 of 6" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/put away for now/);
    expect(hidden).toHaveBeenLastCalledWith(true);
  });

  it("hides the whole transcript section of an untimed video at stage 1", () => {
    const untimed = { ...video, timeline: undefined };
    viewer(listeningData({}), { doc: untimed, pages: [{ page: 1, markdown: "Just words." }] });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("Just words.")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Practise listening" })).toBeInTheDocument();
  });

  it("shows an untimed video's transcript at stage 3", () => {
    const untimed = { ...video, timeline: undefined };
    viewer(listeningData(ladderAt(1, 2)), { doc: untimed, pages: [{ page: 1, markdown: "Just words." }] });
    expect(screen.getByText("Just words.")).toBeVisible();
  });

  it("brings it back at stage 3, hides it again at stage 5, and back once stage 5 is done", () => {
    const hidden = vi.fn();
    viewer(listeningData({}), { onHidden: hidden });
    fireEvent.change(screen.getByLabelText("1: What became visible"), { target: { value: "the gist, not the names" } });
    expect(screen.queryByRole("tab", { name: "Transcript" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("2: What became visible"), { target: { value: "the negation at 0:40" } });
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Study notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
    expect(hidden).toHaveBeenLastCalledWith(false);

    fireEvent.change(screen.getByLabelText("3: What became visible"), { target: { value: "word boundaries" } });
    fireEvent.change(screen.getByLabelText("4: What became visible"), { target: { value: "one term" } });
    expect(screen.queryByRole("tab", { name: "Transcript" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/closed again for stage 5/);
    expect(hidden).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Stage 5 is done" }));
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
    expect(window.localStorage.getItem(markedDoneKey("w1"))).toBe("5");
    expect(hidden).toHaveBeenLastCalledWith(false);
  });

  it("remembers a stage marked done on this device", () => {
    window.localStorage.setItem(markedDoneKey("w1"), "2");
    viewer(listeningData({}));
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
  });

  it("hides nothing on a video with no audit, and offers to start one", async () => {
    const data: ListeningData = { audit: null, audits: [], experiments: [] };
    const posts = viewer(data);
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Practise listening" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening practice" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/documents/doc-v", fields: { intent: "listening-start" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a 14-day experiment" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.fields).toEqual({ intent: "experiment-start" });
  });

  it("puts the transcript away while the retelling is written", () => {
    const hidden = vi.fn();
    viewer(listeningData(ladderAt(1, 2)), { onHidden: hidden });
    fireEvent.click(screen.getByRole("tab", { name: "Practise listening" }));
    expect(hidden).toHaveBeenLastCalledWith(false);
    const retelling = screen.getByLabelText("Retelling with the text closed");
    fireEvent.focus(retelling);
    expect(hidden).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("status")).toHaveTextContent("The transcript is put away while you write the retelling.");
    expect(screen.queryByRole("button", { name: "Explain" })).not.toBeInTheDocument();
    fireEvent.blur(retelling);
    expect(hidden).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
  });
});

describe("Practise listening: timestamps seek", () => {
  it("plays an error-map row from its time, stopping 20 seconds later", () => {
    viewer(listeningData({ errors: { map: [{ row: "", cells: { timestamp: "1:05" } }] } }));
    fireEvent.click(screen.getByRole("button", { name: "Play: row 1 timestamp" }));
    expect(frameSrc()).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=65&rel=0&end=85&autoplay=1");
  });

  it("cannot play a time it cannot read", () => {
    viewer(listeningData({ errors: { map: [{ row: "", cells: { timestamp: "soon" } }] } }));
    expect(screen.getByRole("button", { name: "Play: row 1 timestamp" })).toBeDisabled();
  });

  it("fills in the moment last chosen, and saves it at once", async () => {
    const posts = viewer(listeningData({ ...ladderAt(1, 2), errors: { map: [{ row: "", cells: {} }] } }), { seconds: 7 });
    fireEvent.click(screen.getByRole("tab", { name: "Practise listening" }));
    fireEvent.click(screen.getByRole("button", { name: "Now (00:07): row 1 timestamp" }));
    expect(screen.getByLabelText("Row 1: Timestamp")).toHaveValue("00:07");

    // A line chosen in the transcript becomes the moment.
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    fireEvent.click(screen.getByRole("button", { name: /Play from 00:25/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Practise listening" }));
    fireEvent.click(screen.getByRole("button", { name: "Now (00:25): row 1 timestamp" }));
    expect(screen.getByLabelText("Row 1: Timestamp")).toHaveValue("00:25");
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    const last = posts.at(-1)!;
    expect(last.url).toBe("/toolkit/w1");
    expect(last.fields.section).toBe("errors");
    expect(JSON.parse(last.fields.values ?? "{}")).toEqual({ map: [{ row: "", cells: { timestamp: "00:25" } }] });
  });
});

// ───────────────────────────────────────────── §7: the delayed shadow

let supported: string[] = [];
class FakeRecorder {
  static isTypeSupported(type: string) {
    return supported.includes(type);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["shadow"], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const fetchMock = vi.fn();

describe("Practise listening: §7, the segment and its delayed shadow", () => {
  beforeEach(() => {
    supported = ["audio/webm;codecs=opus"];
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
      configurable: true,
    });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays exactly the segment, from its start to its end", () => {
    viewer(listeningData({ segment: { start: "1:05", end: "1:15" } }));
    fireEvent.click(screen.getByRole("button", { name: "Play segment" }));
    expect(frameSrc()).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=65&rel=0&end=75&autoplay=1");
    fireEvent.click(screen.getByRole("button", { name: "Play: High-impact segment: start" }));
    expect(frameSrc()).toBe("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=65&rel=0&end=75&autoplay=1");
  });

  it("asks for the segment first, and flags one outside 5–20 seconds", () => {
    viewer(listeningData({}));
    expect(screen.getByRole("button", { name: "Play segment" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("High-impact segment: start"), { target: { value: "1:05" } });
    fireEvent.change(screen.getByLabelText("High-impact segment: end"), { target: { value: "1:45" } });
    expect(screen.getByRole("button", { name: "Play segment" })).toBeEnabled();
    expect(screen.getByText("This segment is 40 seconds; up suggests 5–20.")).toBeInTheDocument();
  });

  it("records the delayed shadow beside Play segment, stores it, and plays it back", async () => {
    const kept = take("22222222-2222-4222-8222-222222222222");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(kept), { status: 201 }));
    const posts = viewer(listeningData({ segment: { start: "1:05", end: "1:15" } }));

    const play = screen.getByRole("button", { name: "Play segment" });
    const record = screen.getByRole("button", { name: "Record: Delayed-shadow recording" });
    // Side by side, in the one field.
    const field = record.closest("div.flex") as HTMLElement;
    expect(within(field).getByRole("button", { name: "Play segment" })).toBe(play);

    fireEvent.click(play);
    fireEvent.click(record);
    fireEvent.click(await screen.findByRole("button", { name: "Stop: Delayed-shadow recording" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/toolkit/w1/recordings");
    expect(posts[0]?.url).toBe("/toolkit/w1");
    expect(JSON.parse(posts[0]?.fields.values ?? "{}")).toMatchObject({
      start: "1:05",
      end: "1:15",
      shadow: kept.id,
    });
    expect(await screen.findByLabelText("Delayed-shadow recording")).toHaveAttribute(
      "src",
      `/toolkit/w1/recordings/${kept.id}`,
    );
  });

  it("plays a stored shadow back from this origin", () => {
    const stored = take("33333333-3333-4333-8333-333333333333");
    viewer(listeningData({ segment: { start: "1:05", shadow: stored.id } }, [stored]));
    expect(screen.getByLabelText("Delayed-shadow recording")).toHaveAttribute(
      "src",
      `/toolkit/w1/recordings/${stored.id}`,
    );
  });
});

// ───────────────────────────────────────────── the tutor, on the video's page

describe("Practise listening: the tutor follows the ladder", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function page(listening: ListeningData) {
    const loaderData = {
      content: { document: video, pages },
      notReady: false,
      video: null,
      workspace: { id: "ws1", document_id: "doc-v", session_id: null, progress: { page: 0 } },
      highlights: [{ id: "h1", page: 2, text: "They have really long trunks", created_at: "" }],
      messages: [],
      turns: [],
      notes: [],
      listening,
      passes: { allowed: false, sheet: null },
    };
    const props = { loaderData, params: { docId: "doc-v" } } as unknown as Parameters<typeof DocumentViewer>[0];
    inRouter(<DocumentViewer {...props} />);
  }

  it("is away at stage 1, with the highlights that quote the transcript", () => {
    page(listeningData({}));
    expect(screen.getByText(/The tutor and your highlights are put away/)).toBeInTheDocument();
    expect(screen.queryByText(/Select a passage and choose an action/)).not.toBeInTheDocument();
    expect(screen.queryByText("They have really long trunks")).not.toBeVisible();
  });

  it("comes back at stage 3", () => {
    page(listeningData(ladderAt(1, 2)));
    expect(screen.queryByText(/The tutor and your highlights are put away/)).not.toBeInTheDocument();
    expect(screen.getByText(/Select a passage and choose an action/)).toBeInTheDocument();
  });

  it("goes as soon as the ladder reaches stage 5", () => {
    page(listeningData(ladderAt(1, 2, 3)));
    fireEvent.click(screen.getByRole("tab", { name: "Practise listening" }));
    expect(screen.getByText(/Select a passage and choose an action/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("4: What became visible"), { target: { value: "one term" } });
    expect(screen.queryByText(/Select a passage and choose an action/)).not.toBeInTheDocument();
  });
});
