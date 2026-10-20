/**
 * import-highlights.test.tsx
 * Knowledge → Add → Highlights (plans/261020-1155-open-source-adds, phase 5):
 * the books found in a file, a book already here unticked, and the ticked
 * books sent through the page's own upload as one Markdown file each.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ImportHighlights } from "~/components/knowledge/import-highlights";

beforeAll(() => {
  initI18n("en");
});

const CLIPPINGS = [
  "Meditations (Marcus Aurelius)",
  "- Your Highlight on page 12 | Location 100-101 | Added on Monday",
  "",
  "Begin the morning by saying to thyself…",
  "==========",
  "Walden (Henry David Thoreau)",
  "- Your Highlight on page 3 | Location 40-41 | Added on Monday",
  "",
  "I went to the woods because I wished to live deliberately.",
  "==========",
  "Walden (Henry David Thoreau)",
  "- Your Note on page 90 | Location 900 | Added on Monday",
  "",
  "A loose note.",
  "==========",
].join("\n");

describe("importing highlights", () => {
  it("lists the books, leaves one already here unticked, and uploads one file per book", async () => {
    const uploads: File[][] = [];
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <ImportHighlights titles={["Walden.md", "other.pdf"]} />,
          action: async ({ request }) => {
            const form = await request.formData();
            expect(form.get("intent")).toBe("upload");
            uploads.push(form.getAll("file") as File[]);
            return { uploaded: "Meditations.md" };
          },
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.upload(
      screen.getByLabelText("Choose My Clippings.txt or a KOReader export"),
      new File([CLIPPINGS], "My Clippings.txt", { type: "text/plain" }),
    );
    expect(await screen.findByText("2 books")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Meditations/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Walden/ })).not.toBeChecked();
    expect(screen.getByText(/1 highlight\s*, 1 other note · already a document here/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add 1 book" }));
    expect(await screen.findByText(/1 book added\./)).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    // One file, for the one ticked book. Its name and text are not read
    // here: jsdom's File loses both on the way through a Request. The
    // Markdown is tested in highlights.test.ts, the upload in the browser.
    expect(uploads[0]).toHaveLength(1);
  });

  it("says when a file has no highlights", async () => {
    const router = createMemoryRouter([{ path: "/", element: <ImportHighlights titles={[]} /> }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    await userEvent.upload(screen.getByLabelText("Choose My Clippings.txt or a KOReader export"), new File(["nothing here"], "x.txt"));
    expect(await screen.findByText("No highlights were found in this file.")).toBeInTheDocument();
  });
});
