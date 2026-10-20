/**
 * read-aloud-check.test.tsx
 * The read-aloud check (plans/261020-1155-open-source-adds, phase 2): which
 * selections it is offered for, and the outcome said in words as well as
 * colour — words not heard, heard differently, added — with the engine that
 * heard it and what it heard.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "~/lib/i18n";
import { checkable, CheckOutcome, ReadAloudCheck, type CheckResult } from "~/components/reading/read-aloud-check";

beforeAll(() => {
  initI18n("en");
});

const result: CheckResult = {
  words: [
    { text: "The", state: "ok" },
    { text: "models", state: "ok", added: "um" },
    { text: "are", state: "missed" },
    { text: "based", state: "heard_as", heard: "baste" },
  ],
  ok: 2,
  heard: "The models um baste",
  by: { kind: "builtin" },
  lang: "en",
};

describe("the read-aloud check", () => {
  it("is offered for a selection of one to eighty words", () => {
    expect(checkable("one")).toBe(true);
    expect(checkable(Array(80).fill("w").join(" "))).toBe(true);
    expect(checkable(Array(81).fill("w").join(" "))).toBe(false);
    expect(checkable("   ")).toBe(false);
  });

  it("says each word's state in text, with the engine and what it heard", () => {
    render(<CheckOutcome result={result} onAgain={() => {}} />);
    expect(screen.getByText("2 of 4 words heard as written.")).toBeInTheDocument();
    expect(screen.getByText("(not heard)", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("(heard as baste)", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Not heard:")).toBeInTheDocument();
    expect(screen.getByText("based → baste")).toBeInTheDocument();
    expect(screen.getByText("um")).toBeInTheDocument();
    expect(screen.getByText(/Heard by this server's built-in transcription\./)).toBeInTheDocument();
    expect(screen.getByText("“The models um baste”")).toBeInTheDocument();
    expect(screen.getByText(/not how close your accent is/)).toBeInTheDocument();
  });

  it("names the learner's own connection", () => {
    render(<CheckOutcome result={{ ...result, by: { kind: "own", name: "my groq" } }} onAgain={() => {}} />);
    expect(screen.getByText(/Heard by your connection my groq\./)).toBeInTheDocument();
  });

  it("offers an upload when the browser cannot record", async () => {
    const original = globalThis.MediaRecorder;
    // jsdom has no MediaRecorder: the same as a browser without one.
    vi.stubGlobal("MediaRecorder", undefined);
    render(<ReadAloudCheck docId="d1" page={1} text="The models are based" onClose={() => {}} />);
    expect(screen.getByText("The models are based")).toBeInTheDocument();
    expect(screen.getByText(/It is not kept\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByText(/This browser cannot record here/)).toBeInTheDocument();
    expect(screen.getByLabelText("Upload a recording: Check my reading aloud", { exact: false })).toHaveAttribute("type", "file");
    vi.stubGlobal("MediaRecorder", original);
  });
});
