/**
 * loop-components.test.tsx
 * The two loop components whose honesty matters most, rendered: a Metric
 * always shows its note, and a gate — open or shut — says what it cannot prove.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { Metric } from "~/components/loop/metric";
import { GatePanel } from "~/components/loop/gate-panel";
import type { GateResult } from "~/lib/loop-types";

beforeAll(() => {
  initI18n("en");
});

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el }]);
  return render(<RouterProvider router={router} />);
}

const shut: GateResult = {
  from: "calibrate", to: "stack", open: false, final: false,
  missing: ["Record where you started."],
  cannot_prove: ["A rhythm is not a result."],
  counted: [],
  progress: [{ requirement: "baseline", have: 0, need: 1 }, { requirement: "weekly_reviews", have: 1, need: 2 }],
};

describe("Metric", () => {
  it("renders the value with its cannot-prove note", () => {
    render(<Metric label="Score" value="2/2" cannotProve="One good week is one week." />);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Cannot prove")).toBeInTheDocument();
    expect(screen.getByText("One good week is one week.")).toBeInTheDocument();
  });
});

describe("GatePanel", () => {
  it("a shut gate lists what is missing and still says what it cannot prove", () => {
    inRouter(<GatePanel cycleId="c1" phase="calibrate" gate={shut} />);
    expect(screen.getByText("Record where you started.")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getAllByText("A rhythm is not a result.").length).toBe(2);
    expect(screen.getByRole("button", { name: "Check the gate" })).toBeInTheDocument();
  });

  it("an open gate offers the move and keeps the note", () => {
    const open = { ...shut, open: true, missing: [], progress: [{ requirement: "baseline", have: 1, need: 1 }] };
    inRouter(<GatePanel cycleId="c1" phase="calibrate" gate={open} />);
    expect(screen.getByRole("button", { name: "Move to Stack" })).toBeInTheDocument();
    expect(screen.getByText("A rhythm is not a result.")).toBeInTheDocument();
  });
});
