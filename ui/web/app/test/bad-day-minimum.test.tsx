/**
 * bad-day-minimum.test.tsx
 * up-methods phase 13, rendered: Home's "Today" block and its Low day switch,
 * the minimum contract on the state's edit form, up's six interruption lines,
 * old interruption entries, and the repeated-resistance advice on a state.
 * (The loader and cookie half is bad-day-minimum-server.test.ts.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { TodayBlock, type TodayState } from "~/components/home/today-block";
import { InterruptForm } from "~/components/loop/interrupt-form";
import { InterruptionList } from "~/components/loop/interruption-list";
import { StateBoundaryFields } from "~/components/loop/state-edit-form";
import LoopState from "~/routes/loop.state.$id";
import type { Cycle, GateResult, LearningState, StateDetail } from "~/lib/loop-types";

beforeAll(() => {
  initI18n("en");
});

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el }]);
  return render(<RouterProvider router={router} />);
}

const today: TodayState = {
  id: "st-1",
  goal: "Read Vietnamese news",
  next_task: "Read a full article",
  next_task_minimum: "Read one headline",
  still_worth_keeping: "One headline keeps the habit alive",
};

const learningState: LearningState = {
  id: "st-1",
  goal: "Read Vietnamese news",
  real_scenario: "",
  outcome_12w: "",
  ai_boundaries: { ai_may: [], human_must_confirm: [] },
  baselines: [],
  validated_methods: [],
  hypotheses: [],
  handover_md: "",
  next_task: "Read a full article",
  next_task_minimum: "Read one headline",
  minimum_contract: {
    downshift_when: "Under five hours of sleep",
    still_worth_keeping: "One headline keeps the habit alive",
    ask_for_help_when: "Two bad weeks in a row",
  },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

describe("Home's Today block", () => {
  it("shows the next task and its minimum", () => {
    inRouter(<TodayBlock today={today} lowDay={false} />);
    expect(screen.getByRole("heading", { name: "Your next step" })).toBeInTheDocument();
    expect(screen.getByText("Read a full article")).toBeInTheDocument();
    expect(screen.getByText("Read one headline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Low day" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "Record an interruption" })).toHaveAttribute(
      "href",
      "/loop/state/st-1#lp-state-interrupt",
    );
  });

  it("on a low day shows only the minimum and what is still worth keeping", () => {
    inRouter(<TodayBlock today={today} lowDay />);
    expect(screen.queryByText("Read a full article")).not.toBeInTheDocument();
    expect(screen.queryByText("Next task")).not.toBeInTheDocument();
    expect(screen.getByText("Read one headline")).toBeInTheDocument();
    expect(screen.getByText("One headline keeps the habit alive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Low day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders nothing without a learning state", () => {
    const { container } = inRouter(<TodayBlock today={null} lowDay={false} />);
    expect(screen.queryByRole("heading", { name: "Your next step" })).not.toBeInTheDocument();
    expect(container.querySelector("#lp-today")).toBeNull();
  });

  it("the switch posts to the low-day route and the page follows it", async () => {
    let low = false;
    const posted: string[] = [];
    function Page() {
      const data = useLoaderData() as { low: boolean };
      return <TodayBlock today={today} lowDay={data.low} />;
    }
    const router = createMemoryRouter([
      { path: "/", loader: () => ({ low }), Component: Page },
      {
        path: "/app/api/low-day",
        action: async ({ request }) => {
          const on = String((await request.formData()).get("on"));
          posted.push(on);
          low = on === "1";
          return { ok: true };
        },
      },
    ]);
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: "Low day" }));
    await waitFor(() => expect(screen.queryByText("Read a full article")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Low day" }));
    await waitFor(() => expect(screen.getByText("Read a full article")).toBeInTheDocument());
    expect(posted).toEqual(["1", "0"]);
  });
});

describe("the minimum contract on the edit form", () => {
  it("asks up's three questions with their answers, and says which ones a model sees", () => {
    inRouter(<StateBoundaryFields state={learningState} />);
    const group = screen.getByRole("group", { name: "Minimum contract for bad days" });
    expect(within(group).getByLabelText("When do I shrink the task instead of pushing through?")).toHaveValue(
      "Under five hours of sleep",
    );
    expect(within(group).getByLabelText("After shrinking it, what small action is still worth keeping?")).toHaveValue(
      "One headline keeps the habit alive",
    );
    expect(within(group).getByLabelText("When do I ask for help, or hand this to someone qualified?")).toHaveValue(
      "Two bad weeks in a row",
    );
    expect(within(group).getByText(/The third is never sent to any model/)).toBeInTheDocument();
  });
});

describe("the interruption form", () => {
  it("has up's six lines, with the fact and the 24-hour output required", () => {
    inRouter(<InterruptForm minimum="Read one headline" busy={false} />);
    expect(screen.getByLabelText("What happened, as facts")).toBeRequired();
    const resistance = screen.getByLabelText("Main resistance");
    expect(within(resistance).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      "",
      "time",
      "difficulty",
      "energy",
      "environment",
      "responsibility",
    ]);
    // "Task reduced to" is the existing minimum, prefilled; not required when one exists.
    const reduced = screen.getByLabelText("Task reduced to");
    expect(reduced).toHaveValue("Read one headline");
    expect(reduced).not.toBeRequired();
    expect(screen.getByLabelText("Smallest output you can still make within 24 hours")).toBeRequired();
    expect(screen.getByLabelText("Work I will not make up")).not.toBeRequired();
    expect(screen.getByLabelText("Review date")).toHaveAttribute("type", "date");
  });

  it("requires the reduced task when no minimum was written", () => {
    inRouter(<InterruptForm minimum="" busy={false} />);
    expect(screen.getByLabelText("Task reduced to")).toBeRequired();
  });
});

describe("the interruption list", () => {
  it("shows a new entry's lines and an old entry's note as its fact", () => {
    inRouter(
      <InterruptionList
        items={[
          { at: "2026-09-01T08:00:00Z", note: "Sick", prior_task: "Ten words" },
          {
            at: "2026-10-01T08:00:00Z",
            fact: "Two night shifts",
            resistance: "energy",
            reduced_to: "Two words",
            within_24h: "Say two words aloud",
            not_repaying: "Monday's list",
            review_on: "2026-10-05",
            prior_task: "Ten words",
          },
        ]}
      />,
    );
    const [old, fresh] = screen.getAllByRole("listitem");
    expect(within(old!).getByText("Sick")).toBeInTheDocument();
    expect(within(old!).getByText("Recorded before the six lines existed.")).toBeInTheDocument();
    expect(within(fresh!).getByText("Two night shifts")).toBeInTheDocument();
    expect(within(fresh!).getByText("Energy")).toBeInTheDocument();
    expect(within(fresh!).getByText("Say two words aloud")).toBeInTheDocument();
    expect(within(fresh!).getByText("2026-10-05")).toBeInTheDocument();
    expect(within(fresh!).queryByText("Recorded before the six lines existed.")).not.toBeInTheDocument();
  });
});

describe("the repeated-resistance advice on a state", () => {
  const gate: GateResult = {
    from: "calibrate", to: "stack", open: false, final: false,
    missing: [], cannot_prove: [], counted: [], progress: null,
  };
  const cycle: Cycle = {
    id: "cy-1", state_id: "st-1", started_at: "2026-10-01T00:00:00Z", phase: "calibrate",
    gate_evidence: [], weekly_questions: [], interruptions: [], day90_review_md: "",
  };
  const detail = (repeated: StateDetail["repeated_resistance"]) => ({
    state: learningState, revision: "abc", cycle, gate, chains: [], briefs: [], cards: [], kinds: [], worksheets: [],
    repeated_resistance: repeated,
  });
  const page = (repeated: StateDetail["repeated_resistance"]) => {
    const props = { loaderData: detail(repeated), actionData: undefined, params: { id: "st-1" }, matches: [] };
    return inRouter(<LoopState {...(props as unknown as Parameters<typeof LoopState>[0])} />);
  };

  it("appears when the server reports one, and links to the cycle's weekly capacity", () => {
    page("time");
    const note = screen.getByRole("note");
    expect(within(note).getByText(/all named time/)).toBeInTheDocument();
    expect(within(note).getByRole("link", { name: "Plan this cycle's weekly capacity" })).toHaveAttribute(
      "href",
      "/loop/cycle/cy-1#lp-cycle-questions",
    );
  });

  it("lays the state out as up's Learning State Template, its parts numbered in order", () => {
    page("");
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles.slice(0, 8)).toEqual([
      "If you only have five minutes today",
      "1. Goal",
      "2. Constraints and boundaries",
      "3. Current level and baseline",
      "4. Methods that worked",
      "5. Hypotheses",
      "6. Latest handover",
      "7. Next action",
    ]);
    // Every part's inputs post with the one save form.
    expect(screen.getByLabelText("Real scenario")).toHaveAttribute("form", "lp-state-edit");
    expect(screen.getByLabelText("Next task")).toHaveAttribute("form", "lp-state-edit");
  });

  it("is absent otherwise", () => {
    page("");
    expect(screen.queryByText("The same resistance, three times running")).not.toBeInTheDocument();
  });
});
