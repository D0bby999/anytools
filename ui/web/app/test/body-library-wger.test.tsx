/**
 * body-library-wger.test.tsx
 * The exercise library's names in other languages from wger, credited, and
 * its page with a video (the private design notes, phase 3).
 * No photo: free-exercise-db's were taken out (scraped from bodybuilding.com).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { exerciseName } from "~/lib/body-library";

vi.mock("~/lib/auth.server", () => ({ requireUserId: vi.fn() }));
vi.mock("~/lib/body.server", () => ({ getExercise: vi.fn(), searchExercises: vi.fn() }));
const BodyLibrary = (await import("~/routes/body.library")).default;

beforeAll(() => initI18n("en"));

const squat = {
  id: "0043",
  name: "Barbell full squat",
  body_part: "upper legs",
  equipment: "barbell",
  target: "quads",
  secondary: ["glutes"],
  steps: ["Stand with the bar on your back."],
  wger: { id: 191, names: { es: "Sentadilla con barra" }, licences: { es: "CC BY-SA 4.0" }, authors: { es: "wger.de" }, video: true },
};

function show(detail: Record<string, unknown>) {
  const data = { exercises: [squat], total: 1, facets: { body_parts: [], equipment: [] }, q: "", bodyPart: "", equipment: "", offset: 0, detail };
  const router = createMemoryRouter([{ path: "/body/library", element: <BodyLibrary loaderData={data as never} params={{}} matches={[] as never} /> }], {
    initialEntries: ["/body/library?id=0043"],
  });
  render(<RouterProvider router={router} />);
}

describe("the exercise library", () => {
  it("links wger's page with its video, and shows no photo", () => {
    show(squat);
    expect(screen.getByRole("link", { name: "Video on wger" })).toHaveAttribute("href", "https://wger.de/en/exercise/191/view/");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("names an exercise in the learner's language when wger has it", () => {
    expect(exerciseName(squat, "es")).toBe("Sentadilla con barra");
    expect(exerciseName(squat, "pt-BR")).toBe("Barbell full squat");
  });
});
