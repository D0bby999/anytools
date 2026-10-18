/**
 * zotero-panel.test.tsx
 *
 * "Add from Zotero" (up-methods phase 20): nothing is fetched until the
 * learner asks (each list is a call on their own key), a search shows title,
 * creators, year and item type, collections open level by level, "Add" sends
 * only the item's key, and a learner without a key is sent to Settings.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ZoteroPanel } from "~/components/knowledge/zotero-panel";
import type { AddZoteroData, ZoteroItem, ZoteroListData } from "~/lib/zotero-types";

beforeAll(() => {
  initI18n("en");
});

const rag: ZoteroItem = {
  key: "ABCD2345",
  item_type: "journalArticle",
  title: "Retrieval-Augmented Generation",
  creators: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus", "Fabio Petroni"],
  year: "2020",
};

function renderPanel(opts: {
  loads?: string[];
  posts?: Record<string, string>[];
  list?: (search: URLSearchParams) => ZoteroListData;
  added?: AddZoteroData;
}) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <ZoteroPanel kbId="kb1" /> },
      { path: "/settings/search", element: <p>settings</p> },
      {
        path: "/app/api/zotero",
        loader: ({ request }): ZoteroListData => {
          const url = new URL(request.url);
          opts.loads?.push(url.search);
          return opts.list ? opts.list(url.searchParams) : { ok: true, collections: [], items: [rag] };
        },
        action: async ({ request }): Promise<AddZoteroData> => {
          opts.posts?.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return opts.added ?? { ok: true, title: rag.title, as_pdf: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("ZoteroPanel", () => {
  it("fetches nothing until asked, then lists title, creators, year and type", async () => {
    const loads: string[] = [];
    renderPanel({ loads });
    expect(loads).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Search your library"), "retrieval");
    await userEvent.click(screen.getByRole("button", { name: "Search Zotero" }));
    expect(await screen.findByText("Retrieval-Augmented Generation")).toBeInTheDocument();
    expect(loads[0]).toBe("?kb=kb1&q=retrieval");
    expect(screen.getByText("Patrick Lewis, Ethan Perez, Aleksandra Piktus, … · 2020 · journalArticle")).toBeInTheDocument();
  });

  it("adds an item by its key alone", async () => {
    const posts: Record<string, string>[] = [];
    renderPanel({ posts });
    await userEvent.type(screen.getByLabelText("Search your library"), "rag");
    await userEvent.click(screen.getByRole("button", { name: "Search Zotero" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add to this knowledge base" }));
    await waitFor(() => expect(posts).toEqual([{ kb: "kb1", key: "ABCD2345" }]));
    expect(await screen.findByText(/PDF from your Zotero storage is being read/)).toBeInTheDocument();
  });

  it("says when an item came in as a note, and why its PDF was not used", async () => {
    renderPanel({ added: { ok: true, title: rag.title, as_pdf: false, note: "the PDF is larger than 50 MB" } });
    await userEvent.type(screen.getByLabelText("Search your library"), "rag");
    await userEvent.click(screen.getByRole("button", { name: "Search Zotero" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add to this knowledge base" }));
    expect(await screen.findByText(/Added as a note.*the PDF is larger than 50 MB/)).toBeInTheDocument();
  });

  it("opens collections level by level and back to the top", async () => {
    const loads: string[] = [];
    renderPanel({
      loads,
      list: (q) =>
        q.get("collection") === ""
          ? { ok: true, collections: [{ key: "COLL2345", name: "Retrieval", items: 12, subcollections: 0 }], items: [] }
          : { ok: true, collections: [], items: [rag] },
    });
    await userEvent.click(screen.getByRole("button", { name: "Browse collections" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retrieval" }));
    expect(await screen.findByText("Retrieval-Augmented Generation")).toBeInTheDocument();
    expect(loads).toEqual(["?kb=kb1&collection=", "?kb=kb1&collection=COLL2345"]);
    await userEvent.click(screen.getByRole("button", { name: "All collections" }));
    await waitFor(() => expect(loads).toHaveLength(3));
    expect(loads[2]).toBe("?kb=kb1&collection=");
  });

  it("sends a learner without a key to Settings", async () => {
    renderPanel({ list: () => ({ ok: false, error: "add a Zotero key", notConnected: true }) });
    await userEvent.click(screen.getByRole("button", { name: "Browse collections" }));
    expect(await screen.findByRole("link", { name: "Settings → Search keys" })).toHaveAttribute("href", "/settings/search");
  });
});
