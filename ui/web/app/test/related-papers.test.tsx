/**
 * related-papers.test.tsx
 *
 * Related papers (learning depth, phase 6): nothing is fetched until the
 * learner asks (a fresh list is a model call), the list shows what was
 * searched, and "Add" sends only the paper's id.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { RelatedPapers } from "~/components/knowledge/related-papers";
import type { RelatedData } from "~/lib/papers-types";

beforeAll(() => {
  initI18n("en");
});

function renderSection(loads: string[], posts: Record<string, string>[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <RelatedPapers kbId="kb1" /> },
      {
        path: "/app/api/related",
        loader: ({ request }): RelatedData => {
          loads.push(new URL(request.url).search);
          return {
            ok: true,
            list: {
              focus: "", queries: ["dense retrieval", "rag evaluation"], fallback: false, at: "2026-09-27T00:00:00Z",
              papers: [{ id: "W1", source: "openalex", title: "RAG, revisited", authors: ["A. Author"], year: 2025,
                citations: 12, url: "https://doi.org/10.1/x", open_access: true, license: "cc-by", pdf_url: "https://x/p.pdf" }],
            },
          };
        },
        action: async ({ request }) => {
          posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return { ok: true, title: "RAG, revisited", as_pdf: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RelatedPapers", () => {
  it("fetches nothing until asked, then lists papers and what was searched", async () => {
    const loads: string[] = [];
    renderSection(loads, []);
    expect(loads).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/Focus/), "evaluation");
    await userEvent.click(screen.getByRole("button", { name: "Find related papers" }));
    expect(await screen.findByText("RAG, revisited")).toBeInTheDocument();
    expect(loads[0]).toBe("?kb=kb1&focus=evaluation");
    expect(screen.getByText(/Searched for: dense retrieval · rag evaluation/)).toBeInTheDocument();
    expect(screen.getByText("Open access")).toBeInTheDocument();
  });

  it("adds a paper by its id alone", async () => {
    const posts: Record<string, string>[] = [];
    renderSection([], posts);
    await userEvent.click(screen.getByRole("button", { name: "Find related papers" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add to this knowledge base" }));
    await waitFor(() => expect(posts).toEqual([{ kb: "kb1", id: "W1" }]));
    expect(await screen.findByText(/open-access PDF is being read/)).toBeInTheDocument();
  });
});
