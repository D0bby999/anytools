/**
 * audio-overviews.test.tsx
 *
 * Audio overviews (learning depth, phase 10): the transcript follows the
 * audio, and the audio comes from 'self'. Up-methods phase 22: "Speak it"
 * offers only the engines with voices for the script's language, each with its
 * cost, plus the browser, which reads the script itself.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { AudioOverviews } from "~/components/audio/audio-overviews";
import { currentSegment, segmentStarts, type AudioOverview, type SpeechEngineOption } from "~/lib/audio-types";
import { installFakeSpeech, voice } from "./speech-fake";

beforeAll(() => {
  initI18n("en");
});

const overview = (over: Partial<AudioOverview>): AudioOverview => ({
  id: "o1",
  title: "Retrieval in five minutes",
  language: "en",
  minutes: 5,
  status: "ready",
  sources: [{ id: "S1", title: "RAG paper", page: 3, document_id: "d1" }],
  script: {
    title: "Retrieval in five minutes",
    segments: [
      { speaker: "host", text: "What is retrieval?", source_ids: [] },
      { speaker: "expert", text: "It finds the passages an answer needs, then the model writes from them.", source_ids: ["S1"] },
      { speaker: "host", text: "And then?", source_ids: [] },
    ],
  },
  chunks_done: 1,
  chunks_total: 1,
  audio_bytes: 480_044,
  duration_seconds: 10,
  created_at: "2026-09-27T00:00:00Z",
  ...over,
});

const builtinOption: SpeechEngineOption = {
  engine: "builtin",
  provider: "builtin",
  model: "kokoro",
  voices: { host: "af_heart", expert: "am_michael" },
  usable: true,
  chars: 1234,
  speech_minutes: 1,
  wait_minutes: 2,
  need_minutes: 1,
  daily_minutes: 60,
  used_minutes: 5,
};

const openaiOption: SpeechEngineOption = {
  engine: "byok",
  connection_id: "c1",
  provider: "openai",
  name: "My OpenAI",
  model: "tts-1",
  voices: { host: "nova", expert: "onyx" },
  usable: true,
  chars: 1234,
  speech_minutes: 1,
};

function renderList(overviews: AudioOverview[]) {
  const router = createMemoryRouter(
    [{ path: "/", element: <AudioOverviews overviews={overviews} kbId="kb1" />, loader: () => null }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("segment timing", () => {
  it("gives each turn its share of the time by length", () => {
    const starts = segmentStarts(
      [
        { speaker: "host", text: "aaaa", source_ids: [] },
        { speaker: "expert", text: "bbbbbbbbbbbb", source_ids: [] },
        { speaker: "host", text: "cccc", source_ids: [] },
      ],
      20,
    );
    expect(starts).toEqual([0, 4, 16]);
    expect(currentSegment(starts, 0)).toBe(0);
    expect(currentSegment(starts, 5)).toBe(1);
    expect(currentSegment(starts, 19)).toBe(2);
  });
});

describe("AudioOverviews", () => {
  it("plays the WAV from 'self' and follows it in the transcript", async () => {
    renderList([overview({})]);
    expect(await screen.findByRole("link", { name: "RAG paper · p.3" })).toHaveAttribute("href", "/documents/d1?page=3");
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("/audio-overviews/o1.wav");

    Object.defineProperty(audio!, "currentTime", { value: 5, configurable: true });
    fireEvent.timeUpdate(audio!);
    const current = document.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain("It finds the passages");
  });

  it("offers each way to speak an English script, with its cost, and picks none for the learner", async () => {
    const o = overview({
      status: "script_only",
      chunks_done: 0,
      audio_bytes: 0,
      duration_seconds: 0,
      engines: [builtinOption, openaiOption],
    });
    renderList([o]);
    expect(await screen.findByLabelText("Built-in (free, about 2 minutes)")).toBeEnabled();
    expect(screen.getByText(/Kokoro on this server, voices af_heart and am_michael/)).toBeInTheDocument();
    expect(screen.getByText(/Books up to 1 of your 60 built-in minutes today \(5 used so far\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your OpenAI key/)).toBeEnabled();
    expect(screen.getByText(/Sends 1,234 characters to OpenAI \(tts-1\), voices nova and onyx/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenAI prices" })).toHaveAttribute("href", "https://openai.com/api/pricing/");
    expect(screen.getByLabelText("Read it in the browser")).toBeInTheDocument();
    // Nothing is chosen for the learner.
    expect(screen.getByRole("button", { name: "Speak it" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Built-in (free, about 2 minutes)"));
    expect(screen.getByRole("button", { name: "Speak it" })).toBeEnabled();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("offers a Vietnamese script only the engines that speak it, and the browser", async () => {
    renderList([
      overview({ status: "script_only", language: "vi", chunks_done: 0, audio_bytes: 0, duration_seconds: 0, engines: [openaiOption] }),
    ]);
    expect(await screen.findByLabelText(/Your OpenAI key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Built-in/)).toBeNull();
    expect(screen.getByText("The built-in voices do not speak Vietnamese.")).toBeInTheDocument();
    expect(screen.getByLabelText("Read it in the browser")).toBeInTheDocument();
  });

  it("shows a built-in day used up, with its reason, and lets nobody pick it", async () => {
    const used = { ...builtinOption, usable: false, reason: "2 of your 60 built-in minutes are left today." };
    renderList([overview({ status: "script_only", chunks_done: 0, audio_bytes: 0, duration_seconds: 0, engines: [used] })]);
    expect(await screen.findByLabelText("Built-in (free, about 2 minutes)")).toBeDisabled();
    expect(screen.getByText("2 of your 60 built-in minutes are left today.")).toBeInTheDocument();
  });

  it("reads the script in the browser with a voice for its language", async () => {
    const { fake, remove } = installFakeSpeech([voice("Samantha", "en-US")]);
    try {
      renderList([overview({ status: "script_only", chunks_done: 0, audio_bytes: 0, duration_seconds: 0, engines: [] })]);
      fireEvent.click(await screen.findByLabelText("Read it in the browser"));
      expect(screen.queryByRole("button", { name: "Speak it" })).toBeNull();
      const read = await screen.findByRole("button", { name: "Read it aloud" });
      await waitFor(() => expect(read).toBeEnabled());
      fireEvent.click(read);
      const said = fake.queue.map((u) => u.text).join(" ");
      expect(said).toContain("What is retrieval?");
      expect(said).toContain("It finds the passages an answer needs");
      expect(fake.queue[0]?.voice?.name).toBe("Samantha");
      expect(screen.getByRole("button", { name: "Stop reading" })).toBeInTheDocument();
    } finally {
      remove();
    }
  });

  it("says when the browser has no voice for the script's language", async () => {
    const { remove } = installFakeSpeech([voice("Samantha", "en-US")]);
    try {
      renderList([overview({ status: "script_only", language: "vi", chunks_done: 0, audio_bytes: 0, duration_seconds: 0, engines: [] })]);
      fireEvent.click(await screen.findByLabelText("Read it in the browser"));
      expect(await screen.findByText("Your browser has no voice for this script's language.")).toBeInTheDocument();
    } finally {
      remove();
    }
  });

  it("labels the finished audio with the engine and voices that spoke it", async () => {
    renderList([
      overview({ id: "a", tts_engine: "builtin", tts_model: "kokoro", tts_voices: { host: "af_heart", expert: "am_michael" } }),
      overview({ id: "b", tts_engine: "openai", tts_model: "tts-1", tts_voices: { host: "nova", expert: "onyx" } }),
    ]);
    expect(await screen.findByText("Spoken by the built-in Kokoro · af_heart and am_michael")).toBeInTheDocument();
    expect(screen.getByText("Spoken by your OpenAI key (tts-1) · nova and onyx")).toBeInTheDocument();
  });

  it("shows progress while speaking, and offers Stop", async () => {
    renderList([overview({ status: "synthesizing", chunks_done: 2, chunks_total: 5 })]);
    expect(await screen.findByText("Speaking 2 of 5…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });
});
