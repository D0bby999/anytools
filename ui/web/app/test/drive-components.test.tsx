/**
 * drive-components.test.tsx
 *
 * The Drive UI's promises, rendered:
 *  - an unconnected user is offered Connect, never a Picker that cannot work;
 *  - a connected one gets Add from Drive, then Pick more and Sync now, and the
 *    page says in words that files added to a folder later need Pick more
 *    (AC2's fallback wording — Spike C could not prove otherwise);
 *  - a grant Google stopped honouring reads "Pick again", not "In sync";
 *  - the Picker's selection reaches the route action as bare {id, kind} pairs.
 *
 * Google's Picker itself is mocked: it is a third-party widget that only runs
 * against a live GCP project, which this project does not have yet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { DriveGrant, DriveStatus, PickedItem } from "~/lib/drive-types";

const openDrivePicker = vi.fn<(opts: unknown) => Promise<PickedItem[] | null>>();
vi.mock("~/lib/google-picker.client", () => ({
  openDrivePicker: (opts: unknown) => openDrivePicker(opts),
}));

const { DriveGrants } = await import("~/components/knowledge/drive-grants");
const { DriveConnectionCard, driveStatusTone } = await import("~/components/settings/drive-connection-card");
const { toPicked } = await vi.importActual<typeof import("~/lib/google-picker.client")>(
  "~/lib/google-picker.client",
);

beforeAll(() => {
  initI18n("en");
});

const KB_ID = "kb-1";
const PICKER = { apiKey: "browser-api-key", appId: "123456789012" };

const CONNECTED: DriveStatus = {
  connected: true,
  configured: true,
  needs_reconnect: false,
  grants: 2,
  re_pick: 0,
  removed: 0,
  email: "owner@example.test",
  sync: { last_sync_at: "2026-09-26T08:30:00+07:00", rebaselines: 0 },
};

function grant(over: Partial<DriveGrant>): DriveGrant {
  return {
    id: "g-" + (over.file_id ?? "x"),
    kb_id: KB_ID,
    file_id: "x",
    kind: "file",
    name: "x",
    mime: "text/markdown",
    state: "active",
    granted_at: "2026-09-26T01:00:00Z",
    updated_at: "2026-09-26T01:00:00Z",
    ...over,
  };
}

const GRANTS: DriveGrant[] = [
  grant({ file_id: "fld", kind: "folder", name: "Lecture notes", mime: "application/vnd.google-apps.folder" }),
  grant({
    file_id: "doc1",
    name: "Week 1",
    parent_file_id: "fld",
    document_id: "doc-uuid-1",
    synced_at: "2026-09-26T01:30:00Z",
  }),
  grant({ file_id: "doc2", name: "Week 2", parent_file_id: "fld", state: "re-pick", last_error: "Pick this file again." }),
];

/** Renders in a data router whose action records what the component posted. */
function renderRouted(ui: React.ReactElement, onAction?: (form: FormData) => unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "/knowledge/:kbId",
        element: ui,
        action: async ({ request }) => (onAction ? onAction(await request.formData()) : null),
      },
    ],
    { initialEntries: [`/knowledge/${KB_ID}`] },
  );
  return render(<RouterProvider router={router} />);
}

const fetchMock = vi.fn();
beforeEach(() => {
  openDrivePicker.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DriveGrants", () => {
  it("offers Connect — not a Picker — to an unconnected user", () => {
    renderRouted(
      <DriveGrants kbId={KB_ID} picker={PICKER} status={{ ...CONNECTED, connected: false }} grants={[]} />,
    );

    const connect = screen.getByRole("link", { name: "Connect Google Drive" });
    expect(connect).toHaveAttribute("href", `/auth/drive?next=${encodeURIComponent(`/knowledge/${KB_ID}`)}`);
    expect(screen.queryByRole("button", { name: /Add from Drive|Pick more/ })).toBeNull();
  });

  it("offers Add from Drive when nothing has been picked yet", () => {
    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={[]} />);
    expect(screen.getByRole("button", { name: "Add from Drive" })).toBeInTheDocument();
    // Nothing to sync yet.
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("shows Pick more, Sync now and the AC2 sentence once files are picked", () => {
    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={GRANTS} />);

    expect(screen.getByRole("button", { name: "Pick more" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    // AC2, fallback wording: the page says that later files need Pick more.
    expect(screen.getByText(/Files added to the folder later are not picked up on their own/)).toHaveTextContent(
      "use Pick more to add them",
    );
  });

  it("lists each grant with its sync state, and a Drive-side loss reads Pick again", () => {
    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={GRANTS} />);

    const rows = within(screen.getByRole("list", { name: "Picked from Google Drive" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText("Folder")).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("link", { name: "Week 1" })).toHaveAttribute("href", "/documents/doc-uuid-1");
    expect(within(rows[1]!).getByText("In sync")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/In Lecture notes/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText("2026-09-26 01:30 UTC")).toBeInTheDocument();

    expect(within(rows[2]!).getByText("Pick again")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Pick this file again.")).toBeInTheDocument();
    // Not indexed, so not a dead link.
    expect(within(rows[2]!).queryByRole("link")).toBeNull();
  });

  it("normalises the last sync time to UTC rather than mislabelling the server's zone", () => {
    // The fixture's last sync is 08:30 at +07:00, which is 01:30 UTC.
    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={GRANTS} />);
    const time = screen.getByText(/Last synced/).querySelector("time");
    expect(time).toHaveTextContent("2026-09-26 01:30 UTC");
    expect(time).toHaveAttribute("datetime", "2026-09-26T01:30:00.000Z");
  });

  it("asks for a reconnect, and offers no Picker, when Google stopped honouring the grant", () => {
    renderRouted(
      <DriveGrants kbId={KB_ID} picker={PICKER} status={{ ...CONNECTED, needs_reconnect: true }} grants={GRANTS} />,
    );
    expect(screen.getByRole("link", { name: "Reconnect Google Drive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick more" })).toBeNull();
  });
});

describe("DrivePickerButton", () => {
  it("fetches a token, opens the Picker, and posts the selection to the action", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "ya29.picker" }), { status: 200 }));
    openDrivePicker.mockResolvedValue([
      { id: "fld", kind: "folder" },
      { id: "doc9", kind: "file" },
    ]);
    let posted: FormData | null = null;

    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={[]} />, (form) => {
      posted = form;
      return {
        driveReport: {
          kb_id: KB_ID,
          imported: 2,
          failed: 1,
          items: [{ file_id: "form1", name: "Quiz form", kind: "file", state: "active", error: "Google Forms cannot be imported" }],
        },
      };
    });

    await userEvent.click(screen.getByRole("button", { name: "Add from Drive" }));

    // The token is fetched by POST from this server's own resource route.
    expect(fetchMock).toHaveBeenCalledWith("/app/api/drive/picker-token", { method: "POST" });
    expect(openDrivePicker).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "browser-api-key", appId: "123456789012", accessToken: "ya29.picker" }),
    );

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.get("intent")).toBe("drive-import");
    expect(JSON.parse(String(posted!.get("picked")))).toEqual([
      { id: "fld", kind: "folder" },
      { id: "doc9", kind: "file" },
    ]);

    // The per-item report: a count, and the failure by name with its reason.
    expect(await screen.findByText("2 added from Drive.")).toBeInTheDocument();
    expect(screen.getByText("Quiz form")).toBeInTheDocument();
    expect(screen.getByText(/Google Forms cannot be imported/)).toBeInTheDocument();
  });

  it("posts nothing when the Picker is closed without a pick", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "ya29.picker" }), { status: 200 }));
    openDrivePicker.mockResolvedValue(null);
    const onAction = vi.fn();

    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={[]} />, onAction);
    await userEvent.click(screen.getByRole("button", { name: "Add from Drive" }));

    await waitFor(() => expect(openDrivePicker).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("says reconnect, and never opens the Picker, when the token is refused", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "needs_reconnect" }), { status: 409 }));

    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add from Drive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Reconnect Google Drive/);
    expect(openDrivePicker).not.toHaveBeenCalled();
  });

  it("reports a Picker that failed to load, and stays usable", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "ya29.picker" }), { status: 200 }));
    openDrivePicker.mockRejectedValue(new Error("script blocked"));

    renderRouted(<DriveGrants kbId={KB_ID} picker={PICKER} status={CONNECTED} grants={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add from Drive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/picker could not be opened/);
    expect(screen.getByRole("button", { name: "Add from Drive" })).toBeEnabled();
  });
});

describe("DriveConnectionCard", () => {
  it("offers Connect to an unconnected user and no Disconnect", () => {
    renderRouted(<DriveConnectionCard status={{ ...CONNECTED, connected: false, grants: 0 }} />);
    expect(screen.getByRole("link", { name: "Connect Google Drive" })).toHaveAttribute(
      "href",
      "/auth/drive?next=%2Fsettings",
    );
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("shows the account, the file count and Disconnect when connected", () => {
    renderRouted(<DriveConnectionCard status={CONNECTED} />);
    expect(screen.getByText("owner@example.test")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connect Google Drive/ })).toBeNull();
  });

  it("marks a revoked grant blocked and offers Reconnect beside Disconnect", () => {
    renderRouted(<DriveConnectionCard status={{ ...CONNECTED, needs_reconnect: true }} />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect Google Drive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("asks before disconnecting, and the question says access is revoked at Google", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onAction = vi.fn();
    renderRouted(<DriveConnectionCard status={CONNECTED} />, onAction);

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/revoked at Google/));
    expect(onAction).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("tones: re-pick and a failed sync need attention; connected is green", () => {
    expect(driveStatusTone(CONNECTED)).toBe("green");
    expect(driveStatusTone({ ...CONNECTED, re_pick: 1 })).toBe("warn");
    expect(driveStatusTone({ ...CONNECTED, sync: { rebaselines: 0, last_error: "x" } })).toBe("warn");
    expect(driveStatusTone({ ...CONNECTED, connected: false })).toBe("warn");
    expect(driveStatusTone({ ...CONNECTED, needs_reconnect: true })).toBe("blocked");
  });
});

describe("toPicked", () => {
  const picker = { Document: { ID: "id", MIME_TYPE: "mimeType" } };

  it("keeps only id and kind, and knows a folder by its MIME type", () => {
    expect(
      toPicked(
        [
          { id: "f1", mimeType: "application/vnd.google-apps.folder", name: "Notes", url: "https://…" },
          { id: "d1", mimeType: "application/vnd.google-apps.document", name: "Doc" },
          { mimeType: "text/plain" },
        ],
        picker,
      ),
    ).toEqual([
      { id: "f1", kind: "folder" },
      { id: "d1", kind: "file" },
    ]);
  });
});
