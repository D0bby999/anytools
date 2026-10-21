/**
 * read-pages.test.tsx — phase 08 (plan 261020-2246): the Read pages in up's
 * patterns. A knowledge base's document table carries its status as a badge
 * and keeps a failed document's Retry in the row's flyout menu.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { DocumentTable } from "~/components/knowledge/document-table";
import type { KBDocument } from "~/lib/kb-types";

beforeAll(() => {
  initI18n("en");
});

function doc(over: Partial<KBDocument>): KBDocument {
  return {
    id: "d1",
    kb_id: "kb1",
    source_kind: "upload",
    title: "rag.pdf",
    mime: "application/pdf",
    bytes: 10,
    sha256: "a".repeat(64),
    page_count: 12,
    status: "ready",
    processed_by: {},
    version: 1,
    chunk_count: 40,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    ...over,
  } as KBDocument;
}

function renderAt(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/knowledge/:kbId", element: ui, action: () => null }], {
    initialEntries: ["/knowledge/kb1"],
  });
  return render(<RouterProvider router={router} />);
}

describe("a knowledge base's document table", () => {
  it("shows a failed document's status as a danger badge and Retry in its flyout", async () => {
    renderAt(
      <DocumentTable
        kbId="kb1"
        documents={[doc({}), doc({ id: "d2", title: "broken.docx", status: "failed", error: "could not read it" })]}
      />,
    );

    const failedRow = (await screen.findByRole("rowheader", { name: /broken\.docx/ })).closest("tr")!;
    const badge = within(failedRow).getByText("Failed");
    expect(badge).toHaveClass("lp-badge");
    expect(badge).toHaveAttribute("data-type", "danger");
    expect(within(failedRow).getByText("DOCX")).toBeInTheDocument();

    // Retry is in the menu, not on the row, until the flyout opens.
    const menuButton = within(failedRow).getByRole("button", { name: "Actions for broken.docx" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(within(failedRow).queryByRole("button", { name: "Retry" })).toBeNull();
    await userEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(within(failedRow).getByRole("button", { name: "Retry" })).toBeVisible();

    const readyRow = screen.getByRole("rowheader", { name: /rag\.pdf/ }).closest("tr")!;
    expect(within(readyRow).getByText("Ready")).toHaveAttribute("data-type", "tip");
    expect(within(readyRow).getByText(/12 pages · 40 passages/)).toBeInTheDocument();
    await userEvent.click(within(readyRow).getByRole("button", { name: "Actions for rag.pdf" }));
    expect(within(readyRow).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(readyRow).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/documents/d1");
  });

  it("marks work in progress as info", async () => {
    renderAt(<DocumentTable kbId="kb1" documents={[doc({ status: "parsing" })]} />);
    expect(await screen.findByText("Reading")).toHaveAttribute("data-type", "info");
  });
});
