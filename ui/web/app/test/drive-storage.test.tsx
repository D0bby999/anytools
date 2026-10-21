/**
 * drive-storage.test.tsx
 * Drive-user-storage phase 3 in the web app: a file kept in the learner's
 * Google Drive that cannot be opened or kept says why, in its own sentence
 * (reconnect, removed from Drive, Drive full), wherever it is played or
 * viewed; Disconnect says what happens to the files kept there before it
 * revokes anything; and account deletion says the "AnyTools" folder stays.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { DRIVE_REASONS, driveReason, probeDriveReason } from "~/lib/drive-storage";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import { DriveConnectionCard } from "~/components/settings/drive-connection-card";
import { MediaPlayer } from "~/components/reading/media-player";
import type { DriveStatus } from "~/lib/drive-types";
import type { KBDocument } from "~/lib/kb-types";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api",
  API_TOKEN: "t",
  APP_URL: "http://app.test",
  SESSION_SECRET: "s".repeat(32),
  useSecureCookies: false,
  isProduction: false,
}));

beforeAll(() => {
  initI18n("en");
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function answer(status: number, code: string) {
  return new Response(JSON.stringify({ error: "x", code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routed(ui: React.ReactElement, onAction?: (form: FormData) => unknown) {
  const router = createMemoryRouter(
    [{ path: "/settings", element: ui, action: async ({ request }) => (onAction ? onAction(await request.formData()) : null) }],
    { initialEntries: ["/settings"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("why a Drive file would not load", () => {
  it("reads the API's code, with one byte asked for", async () => {
    fetchMock.mockResolvedValueOnce(answer(409, "drive_reconnect"));
    expect(await probeDriveReason("/documents/d1/file")).toBe("drive_reconnect");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/documents/d1/file");
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");

    fetchMock.mockResolvedValueOnce(answer(410, "drive_file_removed"));
    expect(await probeDriveReason("/x")).toBe("drive_file_removed");
    fetchMock.mockResolvedValueOnce(answer(507, "drive_full"));
    expect(await probeDriveReason("/x")).toBe("drive_full");
  });

  it("is no reason for a file that loads, an ordinary 404 or a network failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("RIFF", { status: 206 }));
    expect(await probeDriveReason("/x")).toBeNull();
    fetchMock.mockResolvedValueOnce(answer(404, "not_found"));
    expect(await probeDriveReason("/x")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await probeDriveReason("/x")).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await probeDriveReason("/x")).toBeNull();
    expect(driveReason("internal")).toBeNull();
  });

  it("gives each reason its own sentence, and reconnecting a link to Settings", () => {
    const sentences = new Set<string>();
    for (const reason of DRIVE_REASONS) {
      const { container, unmount } = routed(<DriveFileNotice reason={reason} />);
      const text = container.textContent ?? "";
      expect(text.length).toBeGreaterThan(20);
      sentences.add(text);
      const link = screen.queryByRole("link", { name: "Reconnect Google Drive" });
      if (reason === "drive_reconnect") expect(link).toHaveAttribute("href", "/settings");
      else expect(link).toBeNull();
      unmount();
    }
    expect(sentences.size).toBe(DRIVE_REASONS.length);
    routed(<DriveFileNotice reason="drive_file_removed" />);
    expect(screen.getByRole("status")).toHaveTextContent(/removed from your Drive/);
  });

  it("the media player asks why when the recording will not play", async () => {
    fetchMock.mockResolvedValue(answer(409, "drive_reconnect"));
    const doc = { id: "doc-1", title: "Lecture", media_mime: "audio/mpeg" } as unknown as KBDocument;
    const { container } = routed(<MediaPlayer document={doc} initialSeconds={0} />);
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.error(audio!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/reconnect Google Drive/i));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/documents/doc-1/media");
  });
});

const CONNECTED: DriveStatus = {
  connected: true,
  configured: true,
  needs_reconnect: false,
  grants: 0,
  re_pick: 0,
  removed: 0,
  email: "owner@example.test",
};

describe("disconnecting a Drive that keeps the learner's files", () => {
  it("says what happens to them first, offers moving them back, and posts only on Disconnect anyway", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const onAction = vi.fn().mockReturnValue(null);
    routed(<DriveConnectionCard status={{ ...CONNECTED, files_in_drive: 42, bytes_in_drive: 1 << 30 }} />, onAction);
    expect(screen.getByText("42")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    const panel = screen.getByRole("region", { name: "Before you disconnect" });
    expect(panel).toHaveTextContent(/stay in your Google Drive/);
    expect(panel).toHaveTextContent(/cannot open them again until you reconnect/);
    expect(panel).toHaveTextContent(/move them back/);
    expect(screen.getByRole("link", { name: "Move my files back first" })).toHaveAttribute("href", "/storage");

    await userEvent.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(screen.queryByRole("region", { name: "Before you disconnect" })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await userEvent.click(screen.getByRole("button", { name: "Disconnect anyway" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect((onAction.mock.calls[0]?.[0] as FormData).get("intent")).toBe("drive-disconnect");
    confirm.mockRestore();
  });

  it("keeps the one-line question when nothing is kept in Drive", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    routed(<DriveConnectionCard status={{ ...CONNECTED, files_in_drive: 0 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("dialog", { name: "Disconnect" })).toHaveTextContent(/revoked at Google/);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Before you disconnect" })).toBeNull();
    confirm.mockRestore();
  });

  it("tells a disconnected learner that files in Drive wait for a reconnect", () => {
    routed(<DriveConnectionCard status={{ ...CONNECTED, connected: false, files_in_drive: 3 }} />);
    expect(screen.getByText(/keeps 3 of your files in your Google Drive/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Drive" })).toBeInTheDocument();
  });
});

describe("deleting the account", () => {
  it("says the AnyTools folder stays in the learner's Drive", async () => {
    const { default: SettingsAccount } = await import("~/routes/settings.account");
    const Page = SettingsAccount as unknown as (props: { loaderData: unknown; actionData: unknown }) => React.ReactElement;
    routed(
      <Page
        loaderData={{ email: "ada@example.com", displayName: "", timezone: "Asia/Ho_Chi_Minh", ownVersionFirst: false }}
        actionData={undefined}
      />,
    );
    expect(screen.getByText(/“AnyTools” folder stays in your Drive/)).toBeInTheDocument();
  });
});
