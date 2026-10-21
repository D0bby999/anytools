/**
 * body-components.test.tsx
 * Body, rendered: every advice reason reads as a sentence with its numbers,
 * Home's block asks only for easy movement on a low day, the heatmap shades
 * the days trained, a proposal shows its evidence, and the nav and parts
 * place Body in Part III.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { AdviceText } from "~/components/body/advice";
import { BodyTodayBlock, type BodyToday } from "~/components/body/body-today";
import { Heatmap } from "~/components/body/heatmap";
import { ProposalView } from "~/components/body/proposal-view";
import { NAV_ITEMS } from "~/components/layout/sidebar";
import { partOf } from "~/lib/parts";
import { num, weekdayNames, type Overview, type Proposal, type Workout } from "~/lib/body-types";
import BodyTodayPage from "~/routes/body";

beforeAll(() => {
  initI18n("en");
});

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el }]);
  return render(<RouterProvider router={router} />);
}

describe("AdviceText", () => {
  const reasons = [
    ["first", {}, /sets the baseline/],
    ["up", { step: 2.5 }, /2\.5 kg more/],
    ["hold", { weight: 100, left: 2 }, /2 more tries/],
    ["deload", { stalls: 3, weight: 90 }, /back to 90 kg/],
    ["range_up", { step: 2.5, reps: 8 }, /back to 8 reps/],
    ["range_hold", { reps: 10 }, /aim for 10 reps/],
    ["range_deload", { stalls: 3, weight: 18 }, /back to 18 kg/],
    ["bodyweight_up", { reps: 11 }, /go for 11/],
    ["bodyweight_hold", {}, /same target/],
    ["time_up", { step: 5 }, /5 seconds more/],
    ["time_hold", {}, /same hold/],
    ["time_deload", { stalls: 3, sec: 40 }, /back to 40 seconds/],
  ] as const;
  it.each(reasons)("%s reads as a sentence with its numbers", (reason, extra, want) => {
    render(<AdviceText advice={{ policy: "linear", kind: "up", reason, ...extra }} unit="kg" />);
    expect(screen.getByText(want)).toBeTruthy();
  });
  it("says nothing for an exercise with no progression", () => {
    const { container } = render(<AdviceText advice={{ policy: "off", kind: "off" }} unit="kg" />);
    expect(container.textContent).toBe("");
  });
});

describe("BodyTodayBlock", () => {
  const base: BodyToday = { routine: "Legs", exercises: 4, trained: false, openId: null, thisWeek: 1, hasPlan: true };
  it("names the planned routine", () => {
    inRouter(<BodyTodayBlock body={base} lowDay={false} />);
    expect(screen.getByText("Legs is planned: 4 exercises.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Body" }).getAttribute("href")).toBe("/body");
  });
  it("asks only for easy movement on a low day", () => {
    inRouter(<BodyTodayBlock body={base} lowDay />);
    expect(screen.getByText(/ten minutes of easy movement is enough/)).toBeTruthy();
    expect(screen.queryByText(/Legs is planned/)).toBeNull();
  });
  it("resumes an open workout", () => {
    inRouter(<BodyTodayBlock body={{ ...base, openId: "w-1" }} lowDay={false} />);
    expect(screen.getByRole("link", { name: "Resume the workout" }).getAttribute("href")).toBe("/body/workouts/w-1");
  });
  it("invites a plan when there is none", () => {
    inRouter(<BodyTodayBlock body={{ ...base, routine: null, hasPlan: false }} lowDay={false} />);
    expect(screen.getByRole("link", { name: "Make a plan" })).toBeTruthy();
  });
});

describe("Heatmap", () => {
  it("counts the days trained and titles each square", () => {
    const { container } = render(
      <Heatmap
        days={[
          { day: "2026-10-12", minutes: 50 },
          { day: "2026-10-19", minutes: 10 },
        ]}
        today="2026-10-19"
      />,
    );
    expect(screen.getByRole("img", { name: "2 days trained in the last year" })).toBeTruthy();
    expect(container.querySelector('[title="2026-10-12: 50 minutes"]')).toBeTruthy();
    expect(container.querySelector('[title="2026-10-19: 10 minutes"]')).toBeTruthy();
  });
});

describe("ProposalView", () => {
  it("shows the changes with their evidence and the plan with its reasons", () => {
    const proposal: Proposal = {
      id: "p",
      kind: "review",
      status: "proposed",
      request: "",
      plan: {
        name: "Full body",
        summary: "Three days.",
        based_on: "8 weeks",
        week: ["", "a", "", "a", "", "a", ""],
        routines: [{ key: "a", name: "Day A", exercises: [{ exercise: "0043", mode: "reps", sets: 3, reps: 5, why: "Legs first." }] }],
      },
      changes: [{ what: "Swap the curl", why: "Stalled 3 sessions" }],
      notes: ["Sleep well."],
      nochange: false,
      reading: "Good block.",
      created_at: "2026-10-19T00:00:00Z",
      decided_at: null,
      can_revert: false,
    };
    render(
      <ProposalView proposal={proposal} names={{ "0043": { name: "barbell full squat", body_part: "", equipment: "", target: "" } }} />,
    );
    expect(screen.getByText("Stalled 3 sessions")).toBeTruthy();
    expect(screen.getByText("barbell full squat")).toBeTruthy();
    expect(screen.getByText("Legs first.")).toBeTruthy();
    // Three scheduled days and a separately navigable routine heading.
    expect(within(screen.getByRole("table", { name: "Full body" })).getAllByText("Day A")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: /Day A/ })).toBeInTheDocument();
  });
});

describe("Body in the book", () => {
  it("is a Part III rail row, off the phone bar", () => {
    const item = NAV_ITEMS.find((n) => n.to === "/body");
    expect(item?.part).toBe("practise");
    expect(item?.phone).toBe(false);
    expect(partOf("/body/workouts/x")).toBe("practise");
  });
  it("formats numbers and weekdays", () => {
    expect(num(105)).toBe("105");
    expect(num(22.5)).toBe("22.5");
    expect(num(null)).toBe("");
    expect(weekdayNames("en")[0]).toBe("Sunday");
  });
});

describe("Body's first run", () => {
  const Page = BodyTodayPage as unknown as (props: { loaderData: { overview: Overview; names: Record<string, never> } }) => ReactElement;
  const overview = (recent: Workout[]): Overview => ({
    profile: { unit: "kg", goal_weight: null, rest_sec: 90, intake: null },
    routines: [],
    week: [null, null, null, null, null, null, null],
    today: { day: "2026-10-20", weekday: 2, routine_id: null, trained: false },
    open: null,
    recent,
    this_week: 0,
    weights: [],
  });
  const plates = (c: HTMLElement) => [...c.querySelectorAll("img")].map((i) => i.getAttribute("src"));

  it("shows Body's plate over the first step, with the coach and writing your own", () => {
    const { container } = inRouter(<Page loaderData={{ overview: overview([]), names: {} }} />);
    expect(plates(container)).toEqual(["/plates/part-body.webp"]);
    expect(screen.getByText(/Two or three short sessions a week/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask the coach for one" }).getAttribute("href")).toBe("/body/coach");
  });

  it("leaves the plate out once a workout is logged", () => {
    const w = {
      id: "w",
      routine_id: null,
      routine_name: "",
      day: "2026-10-19",
      started_at: "",
      finished_at: "",
      bodyweight: null,
      entries: [],
      note: "",
    } as unknown as Workout;
    const { container } = inRouter(<Page loaderData={{ overview: overview([w]), names: {} }} />);
    expect(plates(container)).toEqual([]);
  });
});
