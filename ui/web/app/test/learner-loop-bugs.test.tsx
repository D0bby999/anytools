/**
 * learner-loop-bugs.test.tsx
 * The three bugs a learner hit in the English walkthrough
 * (the private design notes, phase 1): the verdict swapped away by a
 * revalidation, the word picker missing outside English, and speech in the
 * interface language rather than the one spoken.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { I18nextProvider } from "react-i18next";
import { initI18n, loadLanguage } from "~/lib/i18n";
import { answerKeepsTheCard } from "~/lib/card-answers";
import { shouldRevalidate as sessionRevalidate } from "~/routes/mastery.$pathId.session";
import { shouldRevalidate as reviewRevalidate } from "~/routes/mastery.review";
import { TutorPane } from "~/components/reading/tutor-pane";
import { MicButton } from "~/components/chat/composer/mic-button";
import { sentenceLanguages, speak, splitSentences } from "~/lib/speech";
import { speechTag } from "~/lib/languages";
import { installFakeSpeech, voice } from "./speech-fake";

beforeAll(async () => {
  initI18n("en");
  await loadLanguage("vi");
});

function args(formAction: string | undefined) {
  return { formAction, defaultShouldRevalidate: true } as Parameters<typeof sessionRevalidate>[0];
}

describe("an answer keeps its card", () => {
  it("does not reload a session's next card when a card is answered", () => {
    for (const revalidate of [sessionRevalidate, reviewRevalidate]) {
      expect(revalidate(args("/quiz/questions/q1"))).toBe(false);
      expect(revalidate(args("/mastery/points/p1"))).toBe(false);
      // Anything else (Next's revalidate, a navigation) still reloads.
      expect(revalidate(args(undefined))).toBe(true);
      expect(revalidate(args("/settings/routes"))).toBe(true);
    }
    expect(answerKeepsTheCard("/quiz/questions/x")).toBe(true);
    expect(answerKeepsTheCard("/quiz/practice")).toBe(false);
  });
});

describe("the word picker in every interface language", () => {
  it("offers words to save after Vocabulary here, with the line in Vietnamese", () => {
    const i18n = initI18n("vi");
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <I18nextProvider i18n={i18n}>
            <TutorPane
              exchanges={[
                {
                  id: "v",
                  question: "Vocabulary here (page 1):\n\n> She hands the turn back.",
                  answer: "- **hands the turn back**: lets the other person speak",
                  sources: [],
                  page: 1,
                },
                { id: "e", question: "Explain this (page 1):\n\n> x", answer: "It means y.", sources: [], page: 1 },
              ]}
            />
          </I18nextProvider>
        ),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(screen.getByText(/Từ vựng ở đây \(trang 1\):/)).toBeInTheDocument();
    expect(screen.getByText(/Giải thích đoạn này \(trang 1\):/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Tìm từ để lưu/ })).toHaveLength(1);
  });
});

describe("Listen reads each language with its voice", () => {
  let remove: (() => void) | null = null;
  afterEach(() => remove?.());

  it("tells the languages of a Vietnamese answer that quotes English", () => {
    const text = "Đây là cách mở đầu một cuộc trò chuyện. Nice weather today, isn't it? Vâng.";
    const sentences = splitSentences(text);
    expect(sentenceLanguages(sentences, "vi")).toEqual(["vi", "en", "vi"]);
  });

  it("gives a sentence its own voice and language", () => {
    const viVoice = voice("Linh", "vi-VN");
    const enVoice = voice("Samantha", "en-US");
    const installed = installFakeSpeech([viVoice, enVoice]);
    remove = installed.remove;
    speak("Câu này bằng tiếng Việt. This one is in English.", {
      voice: viVoice,
      lang: "vi",
      rate: 1,
      sentenceVoices: [null, enVoice],
    });
    const [first, second] = installed.fake.queue;
    expect(first?.voice).toBe(viVoice);
    expect(first?.lang).toBe("vi-VN");
    expect(second?.voice).toBe(enVoice);
    expect(second?.lang).toBe("en-US");
  });
});

describe("the mic listens for the language chosen", () => {
  type FakeRec = { lang: string; start: () => void; stop: () => void };
  let made: FakeRec[] = [];
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    window.localStorage.clear();
    made = [];
  });

  function installRecogniser() {
    class Rec {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror = null;
      onend = null;
      constructor() {
        made.push(this);
      }
      start() {}
      stop() {}
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = Rec;
  }

  it("offers the studied languages and hears English in a Vietnamese interface", async () => {
    installRecogniser();
    const i18n = initI18n("vi");
    render(
      <I18nextProvider i18n={i18n}>
        <MicButton onText={() => {}} languages={["en"]} />
      </I18nextProvider>,
    );
    const select = await screen.findByRole("combobox", { name: "Nói bằng" });
    expect(select).toHaveValue("vi");
    await userEvent.selectOptions(select, "en");
    await userEvent.click(screen.getByRole("button", { name: /Nói câu hỏi|Nói/ }));
    expect(made.at(-1)?.lang).toBe("en-US");
    expect(window.localStorage.getItem("anytools.chat.micLang")).toBe("en");
  });

  it("shows no choice when the learner studies nothing else", async () => {
    installRecogniser();
    render(<MicButton onText={() => {}} languages={["en"]} />);
    await screen.findByRole("button", { name: "Speak your question" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(speechTag("pt-PT")).toBe("pt-PT");
    expect(speechTag("vi")).toBe("vi-VN");
  });
});
