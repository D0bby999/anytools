/**
 * progress.test.tsx
 * Progress and study circles (the private design notes):
 * the page shows what the API counted, the forms reach the API, and a
 * circle shows members' steadiness with a cheer for each.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const api = {
  getProgress: vi.fn(),
  setProgressSettings: vi.fn(),
  listCircles: vi.fn(),
  getCircle: vi.fn(),
  createCircle: vi.fn(),
  joinCircle: vi.fn(),
  updateCircle: vi.fn(),
  newInvite: vi.fn(),
  leaveCircle: vi.fn(),
  removeMember: vi.fn(),
  cheerMember: vi.fn(),
};
vi.mock("~/lib/progress.server", () => api);
const { ApiError } = await import("~/lib/api.server");
const progressRoute = await import("~/routes/progress");
const circlesRoute = await import("~/routes/circles");
const circleRoute = await import("~/routes/circles.$id");
type Progress = import("~/lib/progress.server").Progress;

const counts = { reviews: 0, questions: 0, explains: 0, workouts: 0, recordings: 0, highlights: 0, skill: 0 };
const progress: Progress = {
  today: "2026-11-15",
  settings: { week_goal: 4, rest_days: 1 },
  streak: { current: 12, longest: 30, studied_today: false, rest_used: 1, rest_left: 0 },
  week: { start: "2026-11-09", days: 3, goal: 4, met: false, in_a_row: 2, longest: 5 },
  level: { level: 4, days: 20, from: 14, next: 30 },
  totals: { ...counts, reviews: 840, questions: 160, workouts: 9 },
  outcomes: { long_term: 120, learning: 300, mastered: 8, explains_passed: 3, right: 90, answered: 100 },
  milestones: [
    { kind: "days", target: 7, value: 20, reached_on: "2026-11-03" },
    { kind: "days", target: 30, value: 20 },
  ],
  calendar: [{ day: "2026-11-14", count: 22 }],
  weeks: Array.from({ length: 12 }, (_, i) => ({ start: `2026-08-${String(24 + i).padStart(2, "0")}`, days: i === 11 ? 3 : 0, count: counts })),
};

function form(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body });
}

function show(element: React.ReactNode) {
  return render(<RouterProvider router={createMemoryRouter([{ path: "/", element, action: () => null }])} />);
}

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: "u1", user: { id: "u1", display_name: "Lan" } });
});

describe("progress", () => {
  it("shows the streak, the week, the level, outcomes and milestones with their evidence", async () => {
    api.getProgress.mockResolvedValue(progress);
    const data = await progressRoute.loader({ request: new Request("http://localhost/progress"), params: {}, context: {} } as never);
    show(<progressRoute.default loaderData={data} actionData={undefined} params={{}} matches={[] as never} />);
    expect(await screen.findByText("A streak of 12 study days.")).toBeTruthy();
    expect(screen.getByText(/Not studied today yet/)).toBeTruthy();
    expect(screen.getByText("3 of 4 study days.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "3 of 4 study days this week" }).getAttribute("aria-valuenow")).toBe("3");
    expect(screen.getByText(/10 more study days to level 5/)).toBeTruthy();
    expect(screen.getByText("120 of 300 cards being learnt")).toBeTruthy();
    expect(screen.getByText("90% of 100")).toBeTruthy();
    const reached = screen.getByRole("link", { name: "7 study days" });
    expect(reached.getAttribute("href")).toBe("/progress#lp-progress-year");
    expect(screen.getByRole("progressbar", { name: "30 study days" }).getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByRole("img", { name: "1 study day in the last year" })).toBeTruthy();
  });

  it("saves the goal and rest days, and says what the API refused", async () => {
    api.setProgressSettings.mockResolvedValue({});
    await expect(progressRoute.action({ request: form({ week_goal: "5", rest_days: "2" }), params: {}, context: {} } as never)).resolves.toEqual({ ok: true });
    expect(api.setProgressSettings).toHaveBeenCalledWith("u1", { week_goal: 5, rest_days: 2 });
    api.setProgressSettings.mockRejectedValue(new ApiError(400, "week_goal must be 1 to 7", "bad_request"));
    await expect(progressRoute.action({ request: form({ week_goal: "9", rest_days: "0" }), params: {}, context: {} } as never)).resolves.toEqual({
      error: "week_goal must be 1 to 7",
    });
  });
});

describe("circles", () => {
  it("creates a circle or joins by code, and opens it", async () => {
    api.createCircle.mockResolvedValue({ id: "c1" });
    const created = (await circlesRoute.action({ request: form({ intent: "create", name: "Evening", nickname: "Lan" }), params: {}, context: {} } as never)) as Response;
    expect(created.headers.get("Location")).toBe("/circles/c1");
    expect(api.createCircle).toHaveBeenCalledWith("u1", "Evening", "Lan");
    api.joinCircle.mockRejectedValue(new ApiError(404, "no such study circle", "not_found"));
    await expect(circlesRoute.action({ request: form({ intent: "join", code: "abc", nickname: "Lan" }), params: {}, context: {} } as never)).resolves.toEqual({
      intent: "join",
      error: "notFound",
    });
  });

  it("offers to join from an invite link, under a name the learner picks", async () => {
    api.listCircles.mockResolvedValue({ circles: [], cheers: [{ from: "Minh", circle_id: "c2", circle: "Runners", at: "2026-11-15T01:00:00Z" }] });
    const data = await circlesRoute.loader({ request: new Request("http://localhost/circles?join=ABCDEFGHJK"), params: {}, context: {} } as never);
    show(<circlesRoute.default loaderData={data} actionData={undefined} params={{}} matches={[] as never} />);
    const invited = await screen.findByRole("region", { name: "You were invited to a study circle" });
    // The account's name is not offered: a circle sees only the name given it.
    expect((within(invited).getByLabelText("Your name in the circle") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Minh cheered you on in/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Runners" }).getAttribute("href")).toBe("/circles/c2");
  });

  it("shows each member's steadiness and a cheer for the others, never for oneself", async () => {
    const brief = { streak: 4, studied_today: true, week_days: 4, week_goal: 4, level: 3, last_studied: "2026-11-15" };
    api.getCircle.mockResolvedValue({
      circle: { id: "c1", name: "Evening", invite_code: "ABCDEFGHJK", members: 2, owner: true, nickname: "Lan", created_at: "" },
      members: [
        { id: "m1", nickname: "Lan", owner: true, me: true, joined_at: "", cheered: false, cheers: 1, progress: brief },
        { id: "m2", nickname: "Minh", owner: false, me: false, joined_at: "", cheered: false, cheers: 0, progress: { ...brief, studied_today: false, week_days: 1, last_studied: "2026-11-10" } },
      ],
      met_goal: 1,
    });
    const data = await circleRoute.loader({ request: new Request("http://localhost/circles/c1"), params: { id: "c1" }, context: {} } as never);
    expect(data.invite).toBe("http://localhost/circles?join=ABCDEFGHJK");
    show(<circleRoute.default loaderData={data} actionData={undefined} params={{ id: "c1" }} matches={[] as never} />);
    expect(await screen.findByText("1 of 2 met their weekly goal")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Cheer/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Cheer Minh on" })).toBeTruthy();
    expect(screen.getByText("1 cheer in the last day")).toBeTruthy();
    expect(screen.getAllByText("goal met")).toHaveLength(1);
    expect(screen.getByText("10 Nov 2026")).toBeTruthy();

    api.getCircle.mockRejectedValue(new ApiError(404, "no such study circle", "not_found"));
    await expect(circleRoute.loader({ request: new Request("http://localhost/circles/x"), params: { id: "x" }, context: {} } as never)).rejects.toMatchObject({
      init: { status: 404 },
    });
  });

  it("sends a cheer, and a leave goes back to the list", async () => {
    api.cheerMember.mockResolvedValue({ new: true });
    await expect(circleRoute.action({ request: form({ intent: "cheer", member: "m2" }), params: { id: "c1" }, context: {} } as never)).resolves.toEqual({
      intent: "cheer",
      ok: true,
    });
    expect(api.cheerMember).toHaveBeenCalledWith("u1", "c1", "m2");
    const left = (await circleRoute.action({ request: form({ intent: "leave" }), params: { id: "c1" }, context: {} } as never)) as Response;
    expect(left.headers.get("Location")).toBe("/circles");
    api.updateCircle.mockRejectedValue(new ApiError(403, "only the circle's owner can do that", "not_owner"));
    await expect(circleRoute.action({ request: form({ intent: "rename", name: "x" }), params: { id: "c1" }, context: {} } as never)).resolves.toEqual({
      intent: "rename",
      message: "only the circle's owner can do that",
    });
  });
});
