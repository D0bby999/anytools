/**
 * reading-components.test.tsx
 * The reader's tutor pane and the notebook editor: what they post, and that a
 * note written by a model cannot become markup.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { TutorPane } from "~/components/reading/tutor-pane";
import { MarkdownPreview } from "~/components/notebook/markdown-preview";
import { NoteEditor } from "~/components/notebook/note-editor";
import type { Note } from "~/lib/reading-types";

beforeAll(() => {
  initI18n("en");
});

function routed(ui: React.ReactElement, posts: Record<string, string | string[]>[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Record<string, string | string[]> = {};
          for (const key of new Set(form.keys())) {
            const all = form.getAll(key).map(String);
            body[key] = all.length > 1 || key === "category_ids" ? all : (all[0] ?? "");
          }
          posts.push(body);
          return { saved: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("TutorPane", () => {
  it("saves a finished answer as a tutor note with the page its question was about", async () => {
    const posts: Record<string, string | string[]>[] = [];
    routed(
      <TutorPane
        exchanges={[
          { id: "e1", question: "Explain this (page 7):\n\n> x", answer: "It means y.", sources: [], page: 7 },
        ]}
      />,
      posts,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save answer to notebook" }));
    await screen.findByRole("button", { name: "Saved" });
    expect(posts[0]).toMatchObject({ intent: "capture", from: "tutor", body_md: "It means y.", page: "7" });
  });

  it("offers no save for an answer still streaming", () => {
    routed(
      <TutorPane exchanges={[{ id: "e1", question: "q", answer: "partial", sources: [], page: 1, streaming: true }]} />,
      [],
    );
    expect(screen.queryByRole("button", { name: /Save answer/ })).toBeNull();
  });
});

describe("MarkdownPreview", () => {
  it("renders Markdown but never raw HTML or a javascript: link", () => {
    const { container } = render(
      <MarkdownPreview source={'**bold** <img src=x onerror="alert(1)"> [click](javascript:alert(1))'} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByText("click").closest("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("never loads a remote image, even one a model wrote (audit F-13)", () => {
    const { container } = render(<MarkdownPreview source={"![chart](https://x.googleusercontent.com/a?q=secret)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[image: chart]").closest("a")?.getAttribute("href")).toBe(
      "https://x.googleusercontent.com/a?q=secret",
    );
  });
});

describe("NoteEditor", () => {
  const note: Note = {
    id: "n1",
    notebook_id: "nb1",
    title: "Memory",
    body_md: "text",
    source: { kind: "document", id: "d1", page: 3 },
    created_by: "agent",
    category_ids: ["c1"],
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
  };

  it("links back to the page and clears categories when every box is unticked", async () => {
    const posts: Record<string, string | string[]>[] = [];
    routed(
      <NoteEditor
        note={note}
        categories={[{ id: "c1", notebook_id: "nb1", name: "Exam", created_at: "" }]}
        notebooks={[]}
      />,
      posts,
    );
    expect(screen.getByRole("link", { name: "Open the source at page 3" })).toHaveAttribute(
      "href",
      "/documents/d1?page=3",
    );
    expect(screen.getByText("Written by the tutor")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Exam" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save" });
    expect(posts[0]).toMatchObject({ intent: "update", noteId: "n1", categories_present: "1" });
    expect(posts[0]?.category_ids ?? []).toEqual([]);
  });
});
