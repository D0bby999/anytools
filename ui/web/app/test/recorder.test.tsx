/**
 * recorder.test.tsx
 * Up-methods phase 7: recording in the browser. MediaRecorder and the
 * microphone are mocked. Nothing is uploaded before "Keep"; the microphone is
 * opened raw (no noise suppression, echo cancellation or gain); a browser
 * that cannot record, or a refused microphone, offers an upload instead; a
 * kept take is written into its cell and saved at once; the shadowing
 * ladder's rebuild lines show only once level four is "not held"; a
 * recording column appears only on its rows; Compare plays two takes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { pickRecordingType, RAW_AUDIO, Recorder } from "~/components/worksheet/recorder";
import { WorksheetMediaContext, type WorksheetMedia } from "~/components/worksheet/audio-cell";
import { WorksheetForm } from "~/components/worksheet/worksheet-form";
import { RecordingsPanel } from "~/components/worksheet/recordings-panel";
import type { Recording, WorksheetKind } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});

let supported: string[] = [];

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(type: string) {
    return supported.includes(type);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["take"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  supported = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function inRouter(el: ReactElement, onAction?: (form: FormData) => unknown) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: el,
      action: async ({ request }) => {
        const form = await request.formData();
        return onAction ? onAction(form) : null;
      },
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("Recorder", () => {
  it("records raw, previews, and uploads nothing until Keep", async () => {
    const onKeep = vi.fn().mockResolvedValue(null);
    render(<Recorder label="Monologue" onKeep={onKeep} />);
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    await screen.findByRole("button", { name: "Stop: Monologue" });
    expect(getUserMedia).toHaveBeenCalledWith(RAW_AUDIO);
    expect(RAW_AUDIO).toEqual({ audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false } });
    expect(FakeRecorder.instances[0]?.mimeType).toBe("audio/webm;codecs=opus");
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");

    fireEvent.click(screen.getByRole("button", { name: "Stop: Monologue" }));
    expect(await screen.findByLabelText("Your take: Monologue")).toHaveAttribute("src", "blob:preview");
    expect(onKeep).not.toHaveBeenCalled();

    // Discard throws the take away without a word to the server.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Record: Monologue" })).toBeInTheDocument();
    expect(onKeep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    await waitFor(() => expect(onKeep).toHaveBeenCalledTimes(1));
    const [blob, type] = onKeep.mock.calls[0] as [Blob, string, number];
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(type).toBe("audio/webm;codecs=opus");
    expect(await screen.findByRole("button", { name: "Record: Monologue" })).toBeInTheDocument();
  });

  it("stops itself at ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      render(<Recorder label="Monologue" onKeep={vi.fn()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
      });
      expect(FakeRecorder.instances[0]?.state).toBe("recording");
      await act(async () => {
        vi.advanceTimersByTime(600_000);
      });
      expect(FakeRecorder.instances[0]?.state).toBe("inactive");
      expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the take when the upload fails, and says why", async () => {
    const onKeep = vi.fn().mockResolvedValue("Your recordings use the 500 MB you have.");
    render(<Recorder label="Monologue" onKeep={onKeep} />);
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("500 MB");
  });

  it("offers an upload when the browser cannot record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const onKeep = vi.fn().mockResolvedValue(null);
    render(<Recorder label="Monologue" onKeep={onKeep} />);
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    expect(await screen.findByRole("status")).toHaveTextContent("cannot record here");
    expect(getUserMedia).not.toHaveBeenCalled();
    const file = new File(["OggS"], "memo.ogg", { type: "audio/ogg" });
    fireEvent.change(screen.getByLabelText("Upload a recording: Monologue"), { target: { files: [file] } });
    // jsdom never reads the file's length, so the measure gives up after 3 s
    // and sends 0; the API still checks the bytes and the limits.
    await waitFor(() => expect(onKeep).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onKeep.mock.calls[0]?.[0]).toBe(file);
    expect(onKeep.mock.calls[0]?.[2]).toBe(0);
    expect(onKeep.mock.calls[0]?.[1]).toBe("audio/ogg");
  });

  it("offers an upload when the microphone is refused", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<Recorder label="Monologue" onKeep={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    expect(await screen.findByRole("status")).toHaveTextContent("microphone is blocked");
    expect(screen.getByLabelText("Upload a recording: Monologue")).toBeInTheDocument();
  });

  it("picks the first type the browser can make", () => {
    supported = ["audio/mp4"];
    expect(pickRecordingType()).toBe("audio/mp4");
    supported = ["audio/ogg;codecs=opus", "audio/mp4"];
    expect(pickRecordingType()).toBe("audio/ogg;codecs=opus");
    supported = [];
    expect(pickRecordingType()).toBeNull();
  });
});

// A served kind in the speaking evidence's shape, invented for the test.
const kind: WorksheetKind = {
  kind: "talk_test",
  name: "Talk test",
  group: "language",
  source: "test",
  summary: "",
  private: false,
  attach: "state",
  version: 1,
  sections: [
    {
      key: "baselines",
      title: "Baselines",
      fields: [
        {
          key: "samples",
          label: "Samples",
          type: "table",
          row_header: "Sample",
          rows: [{ key: "monologue", label: "Monologue" }],
          columns: [
            { key: "recording", label: "Recording", type: "audio" },
            { key: "first_break", label: "First break", type: "text" },
          ],
        },
      ],
    },
    {
      key: "shadowing",
      title: "Shadowing ladder",
      fields: [
        {
          key: "ladder",
          label: "Levels",
          type: "table",
          row_header: "Level",
          rows: [
            { key: "delayed", label: "3. Delayed shadow" },
            { key: "retell", label: "4. Close and retell" },
          ],
          columns: [{ key: "held", label: "Held", type: "yesno" }],
        },
        {
          key: "keyword_1",
          label: "Remembered keyword 1",
          type: "text",
          hint: "Rebuild from three keywords you still remember.",
          show_when: { field: "ladder", row: "retell", column: "held", equals: false },
        },
      ],
    },
    {
      key: "days",
      title: "Days",
      fields: [
        {
          key: "plan",
          label: "Days",
          type: "table",
          row_header: "Day",
          rows: [
            { key: "day1", label: "Day 1" },
            { key: "day2", label: "Day 2" },
            { key: "day5", label: "Day 5", see: { kind: "speaking_evidence", section: "shadowing" } },
          ],
          columns: [
            { key: "recording", label: "Recording", type: "audio", for_rows: ["day1", "day5"] },
            { key: "done", label: "Done", type: "yesno" },
          ],
        },
      ],
    },
  ],
};

const take = (id: string, seconds: number, at: string): Recording => ({
  id,
  worksheet_id: "w1",
  mime: "audio/webm",
  bytes: 100,
  duration_seconds: seconds,
  created_at: at,
});

function withMedia(media: WorksheetMedia, el: ReactElement) {
  return <WorksheetMediaContext.Provider value={media}>{el}</WorksheetMediaContext.Provider>;
}

describe("audio cells in a worksheet", () => {
  it("uploads a kept take, then saves its id in the section at once", async () => {
    const kept = take("11111111-1111-4111-8111-111111111111", 95, "2026-10-16T08:00:00Z");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(kept), { status: 201 }));
    const posted: Record<string, string>[] = [];
    inRouter(
      withMedia(
        { worksheetId: "w1", recordings: [], related: {} },
        <WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="2026-10-16T00:00:00Z" />,
      ),
      (form) => {
        posted.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
        return { section: String(form.get("section")), ok: true, revision: "2026-10-16T00:00:01Z" };
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue: Recording" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop: Monologue: Recording" }));
    await screen.findByRole("button", { name: "Keep" });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/toolkit/w1/recordings");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("duration_seconds")).toMatch(/^\d+\.\d$/);
    expect((body.get("audio") as File).type).toBe("audio/webm;codecs=opus");

    expect(posted[0]?.section).toBe("baselines");
    expect(JSON.parse(posted[0]?.values ?? "{}")).toEqual({
      samples: [{ row: "monologue", cells: { recording: kept.id } }],
    });
    // The cell now plays the kept take from this origin.
    expect(await screen.findByLabelText("Monologue: Recording")).toHaveAttribute(
      "src",
      `/toolkit/w1/recordings/${kept.id}`,
    );
  });

  it("shows the rebuild lines only once level four is not held", () => {
    inRouter(
      withMedia(
        { worksheetId: "w1", recordings: [], related: {} },
        <WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="2026-10-16T00:00:00Z" />,
      ),
    );
    expect(screen.queryByLabelText("Remembered keyword 1")).not.toBeInTheDocument();
    const retell = screen.getByRole("group", { name: "4. Close and retell: Held" });
    fireEvent.click(within(retell).getByLabelText("No"));
    expect(screen.getByLabelText("Remembered keyword 1")).toBeInTheDocument();
    expect(screen.getByText("Rebuild from three keywords you still remember.")).toBeInTheDocument();
    fireEvent.click(within(retell).getByLabelText("Yes"));
    expect(screen.queryByLabelText("Remembered keyword 1")).not.toBeInTheDocument();
    // Level three failing is not level four.
    fireEvent.click(within(screen.getByRole("group", { name: "3. Delayed shadow: Held" })).getByLabelText("No"));
    expect(screen.queryByLabelText("Remembered keyword 1")).not.toBeInTheDocument();
  });

  it("puts a recording only on the days that keep one, and links day 5 to the ladder", () => {
    inRouter(
      withMedia(
        { worksheetId: "w1", recordings: [], related: { speaking_evidence: "sp1" } },
        <WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="2026-10-16T00:00:00Z" />,
      ),
    );
    expect(screen.getByRole("button", { name: "Record: Day 1: Recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record: Day 5: Recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record: Day 2: Recording" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in your speaking evidence" })).toHaveAttribute(
      "href",
      "/toolkit/sp1#ws-shadowing",
    );
  });

  it("says so outside a saved worksheet", () => {
    inRouter(<WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="2026-10-16T00:00:00Z" />);
    expect(screen.getAllByText("Recordings can be added on a saved worksheet.").length).toBeGreaterThan(0);
  });
});

describe("RecordingsPanel", () => {
  it("compares an earlier take with a later one, named by their cells", () => {
    const base = take("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 100, "2026-10-01T08:00:00Z");
    const retest = take("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 75, "2026-10-08T08:00:00Z");
    inRouter(
      <RecordingsPanel
        worksheetId="w1"
        kind={kind}
        answers={{ baselines: { samples: [{ row: "monologue", cells: { recording: base.id } }] } }}
        recordings={[base, retest]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Compare" })).toBeInTheDocument();
    expect(screen.getByLabelText("Earlier take", { selector: "audio" })).toHaveAttribute("src", `/toolkit/w1/recordings/${base.id}`);
    expect(screen.getByLabelText("Later take", { selector: "audio" })).toHaveAttribute("src", `/toolkit/w1/recordings/${retest.id}`);
    expect(screen.getAllByText("Baselines · Monologue · 1:40 · 2026-10-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not in a cell · 1:15 · 2026-10-08").length).toBeGreaterThan(0);
  });

  it("deletes a take through its own route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const only = take("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 10, "2026-10-01T08:00:00Z");
    inRouter(<RecordingsPanel worksheetId="w1" kind={kind} answers={{}} recordings={[only]} />);
    expect(screen.queryByRole("heading", { name: "Compare" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete recording" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/toolkit/w1/recordings/${only.id}`, { method: "DELETE" }));
  });
});
