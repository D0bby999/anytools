/**
 * explanation-language.test.tsx
 * Phase 4 of the private design notes: a lesson switches between the
 * learner's language and the documents', a path chooses its language, and
 * a proposed point the documents hardly cover is marked and kept marked.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { LearnCard } from "~/components/mastery/learn-card";
import { ProposalEditor } from "~/components/mastery/proposal-editor";
import { ExplainLangSelect } from "~/components/mastery/explain-lang-select";
import { parseApproval } from "~/lib/mastery-form";
import type { Explanation } from "~/lib/study-types";

beforeAll(() => {
  initI18n("en");
});

function routed(element: ReactElement, posts: Record<string, string>[], reply: () => unknown = () => null) {
  const handler = async ({ request }: { request: Request }) => {
    posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
    return reply();
  };
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/mastery/points/:pointId", action: handler },
      { path: "/mastery/:pathId", action: handler },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const lesson = (lang: string): Explanation => ({
  id: "x1",
  knowledge_point_id: "kp1",
  model: "m",
  variant: 0,
  body_md: "A lesson.",
  sources: [],
  stale: false,
  cached: true,
  created_at: "2026-10-22T00:00:00Z",
  lang,
});

describe("a lesson's language", () => {
  it("offers the documents' language for a lesson in the learner's, and asks for it", async () => {
    const posts: Record<string, string>[] = [];
    routed(<LearnCard pointId="kp1" pointName="Openers" explanation={lesson("en")} />, posts, () => ({ explanation: lesson("") }));
    await userEvent.click(screen.getByRole("button", { name: "Explain in the documents' language" }));
    expect(posts[0]).toMatchObject({ intent: "learn", variant: "0", lang: "source" });
    // Back the other way once the documents' lesson is shown.
    await screen.findByRole("button", { name: "Explain in English" });
  });

  it("keeps the lesson's language when asking for another angle", async () => {
    const posts: Record<string, string>[] = [];
    routed(<LearnCard pointId="kp1" pointName="Openers" explanation={lesson("")} />, posts);
    await userEvent.click(screen.getByRole("button", { name: "Explain it differently" }));
    expect(posts[0]).toMatchObject({ variant: "1", lang: "source" });
  });

  it("lists the learner's language, the documents', then the languages they study", () => {
    render(<ExplainLangSelect id="x" studied={["en", "ja"]} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["My language (English)", "The documents' language", "Japanese"]);
  });
});

describe("points not in the documents", () => {
  it("names them under their module and keeps the mark on approval", () => {
    routed(
      <ProposalEditor
        pathId="p1"
        proposal={{
          coverage: "checked",
          modules: [
            {
              name: "Openers",
              objective: "",
              pass_threshold: 0.7,
              knowledge_points: [
                { name: "Asking about the weekend", type: "concept" },
                { name: "Adapting tone to the listener", type: "concept", outside_source: true },
              ],
            },
          ],
        }}
      />,
      [],
    );
    expect(screen.getByText("Not found in your documents")).toBeInTheDocument();
    // Only the uncovered point is named in the note.
    expect(screen.getByText("Adapting tone to the listener", { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByText("Asking about the weekend", { selector: "li" })).toBeNull();

    const form = new FormData();
    form.set("modules", "1");
    form.set("module-0-keep", "on");
    form.set("module-0-name", "Openers");
    form.set("module-0-points", "Asking about the weekend\nAdapting tone to the listener\nA new one");
    form.set("types", JSON.stringify({ "Asking about the weekend": "concept", "Adapting tone to the listener": "concept" }));
    form.set("outside", JSON.stringify(["Adapting tone to the listener"]));
    const [module] = parseApproval(form);
    expect(module?.knowledge_points).toEqual([
      { name: "Asking about the weekend", type: "concept" },
      { name: "Adapting tone to the listener", type: "concept", outside_source: true },
      { name: "A new one", type: "concept" },
    ]);
  });
});
