/**
 * drive-integration.test.tsx
 * Drive-user-storage phase 4 in the web app: Disconnect explains what
 * happens to the learner's files when Settings → Storage sends them to
 * Drive, even before the first one is there; and a parse that could not
 * reach its original in Drive offers "Reconnect Google Drive" in the
 * document list.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { DriveConnectionCard } from "~/components/settings/drive-connection-card";
import { DocumentTable } from "~/components/knowledge/document-table";
import type { DriveStatus } from "~/lib/drive-types";
import type { KBDocument } from "~/lib/kb-types";

beforeAll(() => {
  initI18n("en");
});

/** Renders ui under the app shell's route id, whose loader gives the choice. */
function inShell(ui: React.ReactElement, fileStorage: "server" | "drive") {
  const router = createMemoryRouter(
    [
      {
        id: "routes/app-layout",
        path: "/",
        loader: () => ({ fileStorage }),
        HydrateFallback: () => null,
        children: [{ path: "settings", element: ui, action: () => null }],
      },
    ],
    { initialEntries: ["/settings"] },
  );
  return render(<RouterProvider router={router} />);
}

const CONNECTED: DriveStatus = {
  connected: true,
  configured: true,
  needs_reconnect: false,
  grants: 0,
  re_pick: 0,
  removed: 0,
  files_in_drive: 0,
};

describe("disconnecting while new files go to Drive", () => {
  it("says what happens to them even before the first file is there", async () => {
    const confirm = vi.spyOn(window, "confirm");
    inShell(<DriveConnectionCard status={CONNECTED} />, "drive");
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Before you disconnect" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Move my files back first" })).toHaveAttribute("href", "/settings/storage");
    confirm.mockRestore();
  });

  it("keeps the one-line question with storage on the server and nothing in Drive", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    inShell(<DriveConnectionCard status={CONNECTED} />, "server");
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("dialog", { name: "Disconnect" })).toHaveTextContent(/revoked at Google/);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Before you disconnect" })).toBeNull();
    confirm.mockRestore();
  });

  it("follows the storage the page passes over the shell's", async () => {
    inShell(<DriveConnectionCard status={CONNECTED} storage="drive" />, "server");
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("region", { name: "Before you disconnect" })).toBeInTheDocument();
  });
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
    page_count: 1,
    status: "failed",
    processed_by: {},
    version: 1,
    chunk_count: 0,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    ...over,
  } as KBDocument;
}

describe("a parse that could not reach Drive", () => {
  it("offers Reconnect Google Drive beside the reason", async () => {
    inShell(
      <DocumentTable
        kbId="kb1"
        documents={[doc({ error: "Reconnect Google Drive to use the files AnyLearn keeps there.", error_code: "drive_reconnect" })]}
      />,
      "drive",
    );
    const link = await screen.findByRole("link", { name: "Reconnect Google Drive" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link.closest("[data-drive-reason]")).toHaveAttribute("data-drive-reason", "drive_reconnect");
  });

  it("shows a removed file's sentence with no reconnect link", async () => {
    inShell(
      <DocumentTable kbId="kb1" documents={[doc({ error: "This file was removed from your Drive.", error_code: "drive_file_removed" })]} />,
      "drive",
    );
    expect(await screen.findByText("This file was removed from your Drive.")).toHaveAttribute("data-drive-reason", "drive_file_removed");
    expect(screen.queryByRole("link", { name: "Reconnect Google Drive" })).toBeNull();
  });

  it("adds nothing to any other failure, or to an unknown code", async () => {
    inShell(
      <DocumentTable
        kbId="kb1"
        documents={[
          doc({ id: "d1", error: "the uploaded file is no longer available" }),
          doc({ id: "d2", title: "b.pdf", error: "something else", error_code: "<b>drive_reconnect</b>" }),
        ]}
      />,
      "drive",
    );
    // Shown as a sentence (lib/sentence.ts): capital, full stop.
    expect(await screen.findByText("The uploaded file is no longer available.")).not.toHaveAttribute("data-drive-reason");
    expect(screen.queryByRole("link", { name: "Reconnect Google Drive" })).toBeNull();
  });
});
