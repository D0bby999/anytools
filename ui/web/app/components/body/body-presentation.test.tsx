import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { initI18n } from "~/lib/i18n";
import { WeightChart } from "./weight-chart";
import { RestTimer } from "./rest-timer";
import { Heatmap } from "./heatmap";

beforeAll(() => initI18n("en"));
afterEach(() => vi.useRealTimers());

describe("Body's numerical alternatives", () => {
  it("uses every plotted weigh-in in the numerical table", () => {
    const weights = [
      { day: "2026-10-01", weight: 70.5 },
      { day: "2026-10-02", weight: 70.2 },
    ];
    render(<WeightChart weights={weights} goal={68} unit="kg" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(weights.length + 1);
    for (const weight of weights) {
      expect(within(table).getByRole("row", { name: `${weight.day} ${weight.weight}` })).toBeInTheDocument();
    }
  });
  it("keeps a single weigh-in readable before a line can be drawn", () => {
    render(<WeightChart weights={[{ day: "2026-10-01", weight: 70.5 }]} goal={null} unit="kg" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(within(screen.getByRole("table")).getByRole("row", { name: "2026-10-01 70.5" })).toBeInTheDocument();
  });
  it("includes recorded days and minutes but never future days in the heatmap table", () => {
    render(
      <Heatmap
        today="2026-10-20"
        days={[
          { day: "2026-10-19", minutes: 45 },
          { day: "2026-10-20", minutes: 0 },
          { day: "2026-10-21", minutes: 20 },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: "2026-10-19 45" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: "2026-10-20 0" })).toBeInTheDocument();
    expect(within(table).queryByText("2026-10-21")).toBeNull();
  });
});

it("updates the visible rest clock each second but announces only ten-second boundaries and completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  const { container } = render(<RestTimer until={Date.now() + 30000} onChange={() => {}} />);
  const live = container.querySelector('[aria-live="polite"]')!;
  expect(live.textContent).toBe("About 30 seconds of rest remaining");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("0:29")).toBeInTheDocument();
  expect(live.textContent).toBe("About 30 seconds of rest remaining");
  act(() => vi.advanceTimersByTime(9000));
  expect(live.textContent).toBe("About 20 seconds of rest remaining");
  act(() => vi.advanceTimersByTime(20000));
  expect(live.textContent).not.toContain("seconds of rest remaining");
  expect(live.textContent).toBeTruthy();
});

it("keeps one timer above the numbered worksheet when a set is completed", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const { createMemoryRouter, RouterProvider } = await import("react-router");
  const { default: WorkoutPage } = await import("~/routes/body.workouts.$id");
  const props = {
    loaderData: {
      workout: {
        id: "w",
        routine_id: "r",
        routine_name: "Strength",
        day: "2026-10-20",
        started_at: "2026-10-20T12:00:00Z",
        finished_at: null,
        bodyweight: null,
        note: "",
        entries: [
          {
            exercise: "squat",
            target: { exercise: "squat", mode: "reps", sets: 1, reps: 5 },
            sets: [{ weight: 40, reps: 5, done: false }],
          },
        ],
      },
      names: { squat: { name: "Squat", body_part: "legs", equipment: "barbell", target: "quads" } },
      unit: "kg",
      restSec: 90,
    },
  } as unknown as Parameters<typeof WorkoutPage>[0];
  const router = createMemoryRouter([
    { path: "/", element: <WorkoutPage {...props} />, action: () => ({ saved: true }), shouldRevalidate: () => false },
  ]);
  const { container } = render(<RouterProvider router={router} />);
  expect(screen.getByRole("heading", { level: 2, name: "1. Squat" })).toBeInTheDocument();
  const complete = container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
  await userEvent.click(complete);
  expect(complete).toHaveAttribute("aria-pressed", "true");
  expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  expect(screen.getByText("1:30")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Squat" })).toBeInTheDocument();
});
