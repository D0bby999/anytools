/**
 * drive-upload-notices.test.tsx
 * Drive-user-storage phase 5: every upload the learner's Google Drive refuses
 * says why, with what to do, as the knowledge base dropzone already did. A
 * worksheet recording, an exam paper, "Add a link", "Add a site", "Add a
 * repository" and a Drive import each show the notice and its "Reconnect
 * Google Drive" link for drive_reconnect, and their own plain sentence for
 * any other refusal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { AudioCell, WorksheetMediaContext } from "~/components/worksheet/audio-cell";
import { AddLink } from "~/components/knowledge/add-link";
import { AddSite } from "~/components/knowledge/add-site";
import { AddRepo } from "~/components/knowledge/add-repo";
import { ImportResult } from "~/components/knowledge/drive-picker";
import QuizExams from "~/routes/quiz.exams";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api",
  API_TOKEN: "t",
  APP_URL: "http://app.test",
  SESSION_SECRET: "s".repeat(32),
  useSecureCookies: false,
  isProduction: false,
}));

beforeAll(() => {
  initI18n("en");
});

const RECONNECT = "AnyLearn cannot open this file until you reconnect Google Drive.";

/** The notice for drive_reconnect, with its link to Settings. */
async function expectReconnectNotice() {
  expect(await screen.findByText(new RegExp(RECONNECT))).toHaveAttribute("data-drive-reason", "drive_reconnect");
  expect(screen.getByRole("link", { name: "Reconnect Google Drive" })).toHaveAttribute("href", "/settings");
}

function expectNoNotice() {
  expect(document.querySelector("[data-drive-reason]")).toBeNull();
  expect(screen.queryByRole("link", { name: "Reconnect Google Drive" })).toBeNull();
}

/** Renders element at "/", with every form action answering `answer`. */
function routed(element: ReactElement, answer: unknown, actionPaths: string[] = []) {
  const router = createMemoryRouter(
    [
      { path: "/", element, action: () => answer },
      ...actionPaths.map((path) => ({ path, action: () => answer })),
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

class FakeRecorder {
  static isTypeSupported() {
    return true;
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
    this.ondataavailable?.({ data: new Blob(["take"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    configurable: true,
  });
  if (typeof URL.createObjectURL !== "function") {
    Object.assign(URL, { createObjectURL: () => "blob:take", revokeObjectURL: () => {} });
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("a worksheet recording take", () => {
  async function keepATake(status: number, body: unknown) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
    routed(
      <WorksheetMediaContext.Provider value={{ worksheetId: "w1", recordings: [], related: {} }}>
        <AudioCell value={undefined} onChange={vi.fn()} label="Monologue" />
      </WorksheetMediaContext.Provider>,
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop: Monologue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
  }

  it("says the learner's Drive needs reconnecting, and keeps the take to try again", async () => {
    await keepATake(409, { error: "Reconnect Google Drive to use the files AnyLearn keeps there.", code: "drive_reconnect" });
    await expectReconnectNotice();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/toolkit/w1/recordings");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("shows the API's own sentence for any other refusal", async () => {
    await keepATake(413, { error: "A recording is at most 10 MB." });
    expect(await screen.findByRole("alert")).toHaveTextContent("A recording is at most 10 MB.");
    expectNoNotice();
  });
});

describe("an exam paper upload", () => {
  function page(actionData: unknown) {
    const loaderData = { templates: [], exams: [], kbs: [], kbNames: {} };
    const props = { loaderData, actionData, params: {}, matches: [] } as unknown as Parameters<typeof QuizExams>[0];
    return routed(<QuizExams {...props} />, null);
  }

  it("says the learner's Drive needs reconnecting", async () => {
    page({ errorKey: "exams.errors.upload", errorDetail: "paper.pdf: refused", driveReason: "drive_reconnect" });
    await expectReconnectNotice();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the plain sentence for any other refusal", async () => {
    page({ errorKey: "exams.errors.upload", errorDetail: "paper.pdf: that file type is not supported" });
    expect(await screen.findByRole("alert")).toHaveTextContent("that file type is not supported");
    expectNoNotice();
  });
});

describe("Add a link", () => {
  async function add(answer: unknown) {
    routed(<AddLink kbId="kb1" />, answer, ["/knowledge/kb1"]);
    fireEvent.change(document.querySelector("input[type=url]")!, { target: { value: "https://example.com/notes" } });
    fireEvent.submit(document.querySelector("form")!);
  }

  it("says the learner's Drive needs reconnecting", async () => {
    await add({ linkErrorKey: "errors.linkFailed", linkErrorDetail: "refused", driveReason: "drive_reconnect" });
    await expectReconnectNotice();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the plain sentence for any other refusal", async () => {
    await add({ linkErrorKey: "errors.linkFailed", linkErrorDetail: "only https links can be added" });
    expect(await screen.findByRole("alert")).toHaveTextContent("only https links can be added");
    expectNoNotice();
  });
});

describe.each([
  ["Add a site", () => <AddSite kbId="kb1" limits={{ default_depth: 2, max_depth: 3, default_pages: 50, max_pages: 200 }} />],
  [
    "Add a repository",
    () => (
      <AddRepo
        kbId="kb1"
        defaults={{
          doc_extensions: [".md"],
          code_extensions: [".go"],
          max_file_bytes: 2 << 20,
          max_files: 2000,
          max_repo_bytes: 100 << 20,
        }}
      />
    ),
  ],
])("%s", (_name, form) => {
  async function add(answer: unknown) {
    routed(form(), answer, ["/app/api/sources"]);
    fireEvent.change(document.querySelector("input[type=url]")!, { target: { value: "https://github.com/acme/docs" } });
    fireEvent.submit(document.querySelector("form")!);
  }

  it("says the learner's Drive needs reconnecting", async () => {
    await add({ ok: false, intent: "add", error: "refused", driveReason: "drive_reconnect" });
    await expectReconnectNotice();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the plain sentence for any other refusal", async () => {
    await add({ ok: false, intent: "add", error: "that address cannot be fetched" });
    expect(await screen.findByRole("alert")).toHaveTextContent("that address cannot be fetched");
    expectNoNotice();
  });
});

describe("a Drive import", () => {
  it("says the learner's Drive needs reconnecting, for the whole import", async () => {
    routed(
      <ImportResult data={{ driveErrorKey: "drive.errors.importFailed", driveErrorDetail: "", driveReason: "drive_reconnect" }} />,
      null,
    );
    await expectReconnectNotice();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why per picked file the learner's Drive refused to keep", async () => {
    routed(
      <ImportResult
        data={{
          driveReport: {
            kb_id: "kb1",
            imported: 1,
            failed: 2,
            items: [
              { file_id: "a", name: "Week one.pdf", kind: "file", state: "active", error: "Drive needs to be reconnected.", code: "drive_reconnect" },
              { file_id: "b", name: "Quiz form", kind: "file", state: "active", error: "Google Forms cannot be imported" },
            ],
          },
        }}
      />,
      null,
    );
    await expectReconnectNotice();
    expect(screen.getByText("Week one.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/Drive needs to be reconnected/)).toBeNull();
    // The unrelated failure keeps its own sentence.
    expect(screen.getByText(/Google Forms cannot be imported/)).toBeInTheDocument();
  });

  it("shows the plain sentence for any other refusal", async () => {
    routed(<ImportResult data={{ driveErrorKey: "drive.errors.importFailed", driveErrorDetail: "" }} />, null);
    expect(await screen.findByRole("alert")).toHaveTextContent("The files could not be added from Drive.");
    expectNoNotice();
  });
});
