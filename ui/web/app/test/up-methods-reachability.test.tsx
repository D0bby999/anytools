/**
 * up-methods-reachability.test.tsx
 * Up-methods phase 14, requirement 1: the plan's features are reachable from
 * where its UI table says, and the top nav keeps its four links (the phone bar is gone,
 * plan 261020-2246 phase 04).
 *
 * The ways into /toolkit are rendered; the other entry points are pinned by
 * which page renders which component, since each component's own behaviour
 * is tested by its phase.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { flatPages, TOP_NAV } from "~/lib/nav-tree";
import { ToolkitLink } from "~/components/worksheet/toolkit-link";
import { StateWorksheets } from "~/components/worksheet/state-worksheets";
import { RepeatedResistance } from "~/components/loop/repeated-resistance";

beforeAll(() => {
  initI18n("en");
});

function hrefs(element: React.ReactElement): string[] {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  const { unmount } = render(<RouterProvider router={router} />);
  const out = screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "");
  unmount();
  return out;
}

const source = (path: string) => readFileSync(path, "utf8");

describe("the way into /toolkit", () => {
  it("is on /more, the Loop home and every learning state's page", () => {
    expect(flatPages().map((p) => p.to)).toContain("/toolkit");
    expect(hrefs(<ToolkitLink />)).toContain("/toolkit");
    expect(source("app/routes/loop.index.tsx")).toContain("<ToolkitLink />");
    const state = hrefs(<StateWorksheets stateId="st-1" worksheets={[]} />);
    expect(state).toContain("/toolkit");
    expect(state).toContain("/toolkit/new?state=st-1");
    expect(source("app/routes/loop.state.$id.tsx")).toContain("<StateWorksheets ");
  });

  it("keeps the top nav at the four main ways in, and every up-methods page in the tree", () => {
    expect(TOP_NAV.map((i) => i.to)).toEqual(["/home", "/knowledge", "/chat", "/loop"]);
    const tree = flatPages().map((p) => p.to);
    for (const to of ["/toolkit", "/loop", "/mastery/review", "/mastery/vocabulary", "/settings/account", "/home"]) {
      expect(tree, to).toContain(to);
    }
  });
});

describe("the repeated-resistance advice", () => {
  it("links the cycle's weekly capacity, and the recovery reset beside it", () => {
    const links = hrefs(<RepeatedResistance resistance="time" cycleId="cy-1" />);
    expect(links).toEqual(["/loop/cycle/cy-1#lp-cycle-questions", "/toolkit/new?kind=recovery_reset"]);
  });
});

// The plan's "Where each feature lives in the UI": the page or component,
// and what it must render there.
const entryPoints: [feature: string, file: string, renders: string][] = [
  ["English diagnostic, from the Loop's skill cards", "app/components/loop/card-list.tsx", "<DiagnosticPrompt "],
  ["English diagnostic, from a new skill card", "app/components/loop/card-new-form.tsx", "<DiagnosticPrompt "],
  ["Every kind, by group, with New", "app/components/worksheet/toolkit-groups.tsx", "/toolkit/new?kind="],
  ["Listening audit and experiments, on a video", "app/components/reading/video-viewer.tsx", "<ListeningPractice "],
  ["Reading evidence, in the reader's activity panel", "app/routes/documents.$docId.tsx", "<ReadingPasses"],
  ["Vocabulary decisions, in the reader's word picker", "app/components/vocab/word-picker.tsx", "<DecisionFields"],
  ["Vocabulary decisions, in Mastery → Vocabulary", "app/components/vocab/word-list.tsx", "<DecisionFields"],
  ["Mastery → Vocabulary renders the word list", "app/routes/mastery.vocabulary.tsx", "<WordList"],
  ["Save the word, from a vocabulary barrier", "app/components/reading/reading-passes.tsx", "<WordPicker "],
  ["Day-90 close, on a cycle's page", "app/routes/loop.cycle.$id.tsx", "<CycleCloseLink"],
  ["Own version first, in Settings → Account", "app/routes/settings.account.tsx", "<OwnVersionSetting"],
  ["Own version first, in the chat composer", "app/components/chat/composer.tsx", "<OwnVersionFields "],
  ["Own version first, in Solve", "app/components/solve/solve-form.tsx", "<OwnVersionFields "],
  ["Interleaved review, from Home", "app/routes/home.tsx", "<ReviewAllLink "],
  ["Interleaved review, from Mastery", "app/routes/mastery.index.tsx", "<ReviewAllLink "],
  ["Bad-day minimum, on Home's Today block", "app/routes/home.tsx", "<TodayBlock "],
  ["Bad-day minimum, on a learning state's page", "app/routes/loop.state.$id.tsx", "<InterruptForm minimum="],
  ["Worksheet reviews due, on Home", "app/routes/home.tsx", "<WorksheetsDue "],
];

describe("each feature's entry point", () => {
  it.each(entryPoints)("%s", (_feature, file, renders) => {
    expect(source(file)).toContain(renders);
  });

  it("names only registered routes", () => {
    const routes = source("app/routes.ts");
    for (const path of ["toolkit", "toolkit/new", "toolkit/:id", "mastery/review", "mastery/vocabulary", "more"]) {
      expect(routes, path).toContain(`"${path}"`);
    }
  });
});
