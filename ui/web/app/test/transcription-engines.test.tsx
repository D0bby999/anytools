/**
 * transcription-engines.test.tsx
 * Up-methods phase 21 in the browser: the engine picker offers what the
 * server listed, each with its cost, and starts nothing until the learner
 * picks one; a Gemini-only learner sees the page as before; the transcript's
 * label names who heard it; readiness marks speech to text as optional.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { NeedsTranscript } from "~/components/reading/needs-transcript";
import { whisperLabel } from "~/components/reading/engine-picker";
import { VideoViewer } from "~/components/reading/video-viewer";
import { ReadinessMatrix } from "~/components/settings/readiness-matrix";
import type { DocumentView, EngineOption, KBDocument, TranscribeEstimate } from "~/lib/kb-types";

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
          for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : `file:${v.name}`;
          posts.push(body);
          return null;
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
  title: "A talk",
  mime: "text/vtt",
  bytes: 0,
  sha256: "x",
  page_count: 0,
  status: "needs_transcript",
  error: "YouTube did not let this server read the captions.",
  processed_by: {},
  version: 1,
  chunk_count: 0,
  created_at: "",
  updated_at: "",
  media_id: "jNQXAC9IVRw",
  media: { duration_seconds: 600 },
};

const builtin: EngineOption = {
  engine: "builtin",
  provider: "builtin",
  model: "Systran/faster-whisper-small",
  usable: true,
  downloads: true,
  audio_minutes: 10,
  wait_minutes: 3,
  daily_minutes: 120,
  used_minutes: 20,
  queue_ahead: 2,
};
const groq: EngineOption = {
  engine: "byok",
  connection_id: "conn-groq",
  provider: "groq",
  name: "my groq",
  model: "whisper-large-v3-turbo",
  usable: true,
  downloads: true,
  audio_minutes: 10,
};
const gemini: EngineOption = { engine: "gemini", provider: "gemini", usable: true, downloads: false, estimated_tokens: 60000 };

function estimate(engines: EngineOption[], extra: Partial<TranscribeEstimate> = {}): TranscribeEstimate {
  return {
    available: engines.some((e) => e.usable),
    duration_seconds: 600,
    estimated_tokens: 60000,
    windows: 1,
    free_tier_daily_seconds: 28800,
    engines,
    ...extra,
  };
}

describe("the engine picker", () => {
  it("lists every engine with its cost and starts nothing until one is picked", async () => {
    const posts: Post[] = [];
    const view: DocumentView = { document: video, transcribe: estimate([builtin, groq, gemini]) };
    routed(<NeedsTranscript view={view} />, posts);

    const free = screen.getByRole("radio", { name: "Built-in (free, about 3 min)" });
    const mine = screen.getByRole("radio", { name: /Your Groq key/ });
    screen.getByRole("radio", { name: "Your Gemini key" });
    expect(screen.getByText(/Whisper small on this server, with no key/)).toBeInTheDocument();
    expect(screen.getByText("20 of your 120 built-in minutes used today. This video needs 10.")).toBeInTheDocument();
    expect(screen.getByText(/waiting for the built-in engine now: 2/)).toBeInTheDocument();
    expect(screen.getByText(/sends it to Groq with your key \(whisper-large-v3-turbo\)\. About 10 min of audio/)).toBeInTheDocument();
    expect(screen.getByText("About 60,000 tokens: 10 min at 100 tokens a second.")).toBeInTheDocument();
    // Each paid engine links to its provider's prices; the built-in one has none.
    expect(screen.getByRole("link", { name: "Groq prices" })).toHaveAttribute("href", "https://groq.com/pricing");
    expect(screen.getByRole("link", { name: "Google Gemini prices" })).toHaveAttribute(
      "href",
      "https://ai.google.dev/gemini-api/docs/pricing",
    );
    expect(screen.queryByRole("link", { name: /This server prices/ })).toBeNull();

    // Nothing is chosen for the learner.
    expect(free).not.toBeChecked();
    const start = screen.getByRole("button", { name: "Transcribe" });
    expect(start).toBeDisabled();
    expect(posts).toHaveLength(0);

    await userEvent.click(mine);
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ intent: "transcribe", engine: "byok", connection_id: "conn-groq", choice: "byok:conn-groq" });

    await userEvent.click(free);
    await userEvent.click(start);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ intent: "transcribe", engine: "builtin", choice: "builtin" });
  });

  it("shows why an engine cannot start and does not let it be picked", () => {
    const spent: EngineOption = {
      ...builtin,
      usable: false,
      used_minutes: 115,
      reason: "This video is 10 min; 5 of your 120 built-in minutes are left today.",
    };
    routed(<NeedsTranscript view={{ document: video, transcribe: estimate([spent, groq]) }} />);
    expect(screen.getByRole("radio", { name: /Built-in/ })).toBeDisabled();
    expect(screen.getByText(/5 of your 120 built-in minutes are left today/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Your Groq key/ })).toBeEnabled();
  });

  it("warns that YouTube refused the audio before, on the engines that download it", () => {
    routed(<NeedsTranscript view={{ document: video, transcribe: estimate([builtin, gemini], { audio_blocked: true }) }} />);
    const rows = screen.getAllByRole("listitem");
    const builtinRow = rows.find((r) => within(r).queryByRole("radio", { name: /Built-in/ }));
    const geminiRow = rows.find((r) => within(r).queryByRole("radio", { name: "Your Gemini key" }));
    expect(builtinRow).toHaveTextContent(/refused this server the audio last time/);
    expect(geminiRow).not.toHaveTextContent(/refused this server the audio/);
  });

  it("with Gemini as the only engine, the page is what it was", async () => {
    const posts: Post[] = [];
    routed(<NeedsTranscript view={{ document: video, transcribe: estimate([gemini]) }} />, posts);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("heading", { name: "Transcribe with your Gemini key" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ intent: "transcribe" });
  });
});

describe("the transcript's label", () => {
  const ready: KBDocument = {
    ...video,
    status: "ready",
    error: "",
    page_count: 1,
    timeline: [[0, 8]],
    transcript_source: "ai_transcript",
  };
  const page = [{ page: 1, markdown: "[00:00] The beach was a popular spot." }];
  const viewer = (doc: KBDocument) => (
    <VideoViewer document={doc} pages={page} initialSeconds={0} busy={false} onAsk={() => {}} />
  );

  it("names this server's Whisper and keeps the AI transcript warning", () => {
    routed(viewer({ ...ready, processed_by: { engine: "builtin", model: "Systran/faster-whisper-small" } }));
    expect(screen.getByRole("note")).toHaveTextContent(
      /AI transcript, transcribed by Whisper small on this server.*misheard/,
    );
  });

  it("names the learner's key and model", () => {
    routed(viewer({ ...ready, processed_by: { engine: "groq", model: "whisper-large-v3-turbo" } }));
    expect(screen.getByRole("note")).toHaveTextContent(/transcribed by your Groq key \(whisper-large-v3-turbo\).*misheard/);
  });

  it("keeps the Gemini sentence for a Gemini transcript", () => {
    routed(viewer({ ...ready, processed_by: { parser: "gemini", model: "gemini-2.5-flash" } }));
    expect(screen.getByRole("note")).toHaveTextContent(/made by your Gemini key/);
  });

  it("reads faster-whisper model ids as people do", () => {
    expect(whisperLabel("Systran/faster-whisper-small")).toBe("Whisper small");
    expect(whisperLabel("deepdml/faster-whisper-large-v3-turbo-ct2")).toBe("Whisper large-v3-turbo");
  });
});

describe("readiness", () => {
  it("marks speech to text optional and lists the built-in engine", () => {
    render(
      <ReadinessMatrix
        optional={["tts", "stt"]}
        functions={[
          {
            function: "stt",
            status: "green",
            reason: "",
            entries: [
              {
                connection_id: "00000000-0000-0000-0000-000000000000",
                name: "Built-in transcription (free, slower)",
                provider: "builtin",
                model: "",
                status: "green",
              },
            ],
          },
          { function: "chat", status: "green", reason: "", entries: [] },
        ]}
      />,
    );
    const stt = screen.getByRole("rowheader", { name: /Speech to text/ });
    expect(stt).toHaveTextContent("Optional");
    expect(screen.getByRole("rowheader", { name: "Chat" })).not.toHaveTextContent("Optional");
    expect(screen.getByText("Built-in transcription (free, slower)")).toBeInTheDocument();
  });
});
