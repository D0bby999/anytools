/**
 * storage-settings.test.tsx
 * Settings → Storage and "Save to my Drive" in the browser
 * (drive-user-storage phase 2): the choice between the server and Drive, its
 * disabled state without a working Drive, a move's progress in files and
 * bytes, and the export button that appears only with Drive storage on.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useActionData } from "react-router";
import { initI18n } from "~/lib/i18n";
import { StoragePanel, type StorageActionData } from "~/components/storage/storage-panel";
import { SaveToDrive } from "~/components/storage/save-to-drive";
import { formatBytes, type StorageStatus } from "~/lib/storage-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, opts: { posts?: Post[]; answer?: unknown } = {}) {
  const posts = opts.posts ?? [];
  const record = async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const body: Post = {};
    for (const [k, v] of form.entries()) body[k] = String(v);
    posts.push(body);
    return opts.answer ?? { intent: "choose", ok: true };
  };
  const router = createMemoryRouter(
    [
      { path: "/", element: ui, action: record },
      { path: "/settings", element: <p>Connections</p> },
      { path: "/app/api/save-to-drive", action: record },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

/** The panel as the route renders it: the action's answer comes back as a prop. */
function Wired({ status }: { status: StorageStatus }) {
  const result = useActionData() as StorageActionData | undefined;
  return <StoragePanel status={status} pending={false} result={result} />;
}

const base: StorageStatus = {
  storage: "server",
  drive: { configured: true, ready: true },
  usage: { server_files: 380, server_bytes: 6_400_000_000, drive_files: 0, drive_bytes: 0, drive_missing: 0 },
  move: null,
};

describe("Settings → Storage", () => {
  it("offers both places and posts the choice", async () => {
    const posts: Post[] = [];
    routed(<Wired status={base} />, { posts });
    const server = screen.getByRole("radio", { name: /On AnyLearn's server/ });
    const drive = screen.getByRole("radio", { name: /In my Google Drive/ });
    expect(server).toBeChecked();
    expect(drive).toBeEnabled();
    expect(screen.getByText(/the search index built from that text/)).toBeInTheDocument();

    await userEvent.click(drive);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(posts).toEqual([{ intent: "choose", storage: "drive" }]);
    expect(await screen.findByText(/New files now go where you chose/)).toBeInTheDocument();
  });

  it("disables Drive without a working connection and says why", () => {
    routed(<StoragePanel status={{ ...base, drive: { configured: true, ready: false, reason: "drive_not_connected" } }} pending={false} />);
    expect(screen.getByRole("radio", { name: /In my Google Drive/ })).toBeDisabled();
    expect(screen.getByText("Connect Google Drive to keep your files there.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Connections" })).toHaveAttribute("href", "/settings");
    // Nothing can be moved without Drive.
    expect(screen.queryByRole("button", { name: /Move my files/ })).toBeNull();
  });

  it("says when Google stopped accepting the connection", () => {
    routed(<StoragePanel status={{ ...base, drive: { configured: true, ready: false, reason: "drive_reconnect" } }} pending={false} />);
    expect(screen.getByRole("radio", { name: /In my Google Drive/ })).toBeDisabled();
    expect(screen.getByText(/Reconnect it to keep your files there/)).toBeInTheDocument();
  });

  it("shows only the server without Drive on this server", () => {
    routed(<StoragePanel status={{ ...base, drive: { configured: false, ready: false } }} pending={false} />);
    expect(screen.getByRole("radio", { name: /In my Google Drive/ })).toBeDisabled();
    expect(screen.getByText(/not set up on this server/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Connections" })).toBeNull();
    expect(screen.queryByText("Space used")).toBeNull();
  });

  it("offers to move the files from before, in the chosen direction", async () => {
    const posts: Post[] = [];
    routed(<StoragePanel status={{ ...base, storage: "drive" }} pending={false} />, { posts, answer: { intent: "move", ok: true } });
    const usage = screen.getByRole("heading", { name: "Space used" }).closest("section")!;
    expect(within(usage).getByText("380 files, 6.4 GB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move my files to Drive" }));
    expect(posts).toEqual([{ intent: "move" }]);
  });

  it("offers to move back once the choice is the server again", () => {
    routed(
      <StoragePanel
        status={{ ...base, usage: { ...base.usage, server_files: 0, server_bytes: 0, drive_files: 3, drive_bytes: 2048 } }}
        pending={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Move my files back to the server" })).toBeInTheDocument();
  });

  it("shows a running move's progress in files and bytes, and can stop it", async () => {
    const posts: Post[] = [];
    const status: StorageStatus = {
      ...base,
      storage: "drive",
      move: { id: "m1", direction: "to_drive", status: "running", done: 142, total: 380, done_bytes: 2_100_000_000, total_bytes: 6_400_000_000 },
    };
    routed(<Wired status={status} />, { posts, answer: { intent: "cancel", ok: true } });
    expect(screen.getByText("142 of 380 files, 2.1 GB of 6.4 GB")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "142");
    expect(bar).toHaveAttribute("aria-valuemax", "380");
    // The choice cannot change mid-move.
    expect(screen.getByRole("radio", { name: /On AnyLearn's server/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Move my files/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Stop moving" }));
    expect(posts).toEqual([{ intent: "cancel" }]);
    expect(await screen.findByText(/Stopping after the file being moved/)).toBeInTheDocument();
  });

  it("says why a move stopped, by its code", () => {
    const failed = (error: "drive_full" | "drive_reconnect" | "move_failed") =>
      ({ ...base, storage: "drive", move: { id: "m1", direction: "to_drive", status: "failed", done: 1, total: 3, done_bytes: 1, total_bytes: 3, error } }) as StorageStatus;
    const { unmount } = routed(<StoragePanel status={failed("drive_full")} pending={false} />);
    expect(screen.getByText(/Your Google Drive is full, so the move stopped/)).toBeInTheDocument();
    unmount();
    routed(<StoragePanel status={failed("move_failed")} pending={false} />);
    expect(screen.getByText(/start it again to carry on/)).toBeInTheDocument();
  });
});

describe("Save to my Drive", () => {
  it("is absent while files are kept on the server", () => {
    routed(<SaveToDrive kind="worksheet" id="w1" storage="server" />);
    expect(screen.queryByRole("button", { name: "Save to my Drive" })).toBeNull();
  });

  it("posts what to save and links to the saved file", async () => {
    const posts: Post[] = [];
    routed(<SaveToDrive kind="study_notes" id="doc-1" language="vi" storage="drive" />, {
      posts,
      answer: { ok: true, url: "https://drive.google.com/file/d/abc/view", name: "notes.md" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save to my Drive" }));
    expect(posts).toEqual([{ kind: "study_notes", id: "doc-1", language: "vi" }]);
    const link = await screen.findByRole("link", { name: /Open in Drive/ });
    expect(link).toHaveAttribute("href", "https://drive.google.com/file/d/abc/view");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never links anywhere but Google Drive", async () => {
    routed(<SaveToDrive kind="book" id="b1" storage="drive" />, { answer: { ok: true, url: "https://evil.example/x", name: "x.md" } });
    await userEvent.click(screen.getByRole("button", { name: "Save to my Drive" }));
    expect(await screen.findByText("Saved to your Drive.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open in Drive/ })).toBeNull();
  });

  it("words a refusal", async () => {
    routed(<SaveToDrive kind="notebook" id="n1" storage="drive" />, { answer: { ok: false, errorKey: "export.full" } });
    await userEvent.click(screen.getByRole("button", { name: "Save to my Drive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your Google Drive is full.");
  });
});

describe("formatBytes", () => {
  it("reads like Drive", () => {
    expect(formatBytes(12)).toBe("12 bytes");
    expect(formatBytes(640_000)).toBe("640 KB");
    expect(formatBytes(2_100_000_000)).toBe("2.1 GB");
    expect(formatBytes(6_400_000_000)).toBe("6.4 GB");
  });
});
