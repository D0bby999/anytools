/**
 * body-library-photos.test.tsx
 * The exercise library's photos, credits and other-language names (plans/
 * a private plan, phase 3).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { exerciseName, exercisePhotos } from "~/lib/body-library";

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
  source: "opengym" as const,
  photo: "Barbell_Full_Squat",
  wger: { id: 191, names: { es: "Sentadilla con barra" }, licences: { es: "CC BY-SA 4.0" }, authors: { es: "wger.de" }, video: true },
};

function show(detail: typeof squat | Record<string, unknown>) {
  const data = { exercises: [squat], total: 1, facets: { body_parts: [], equipment: [] }, q: "", bodyPart: "", equipment: "", offset: 0, detail };
  const router = createMemoryRouter([{ path: "/body/library", element: <BodyLibrary loaderData={data as never} params={{}} matches={[] as never} /> }], {
    initialEntries: ["/body/library?id=0043"],
  });
  render(<RouterProvider router={router} />);
}

describe("the exercise library", () => {
  it("shows the start and end photos, credited, and wger's page with its video", () => {
    show(squat);
    const start = screen.getByRole("img", { name: "Barbell full squat: the start" });
    expect(start).toHaveAttribute("src", "/tool-runtime/free-exercise-db@0.0.0-f00c92c/Barbell_Full_Squat-0.jpg");
    expect(screen.getByRole("img", { name: "Barbell full squat: the end" })).toHaveAttribute("src", expect.stringMatching(/-1\.jpg$/));
    expect(screen.getByText(/Photos: free-exercise-db, public domain/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Video on wger" })).toHaveAttribute("href", "https://wger.de/en/exercise/191/view/");
  });

  it("shows no photo where there is none", () => {
    show({ ...squat, photo: undefined, wger: undefined });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/^Photos: free-exercise-db/)).toBeNull();
  });

  it("names an exercise in the learner's language when wger has it", () => {
    expect(exerciseName(squat, "es")).toBe("Sentadilla con barra");
    expect(exerciseName(squat, "pt-BR")).toBe("Barbell full squat");
    expect(exercisePhotos({ photo: undefined })).toBeNull();
  });
});
