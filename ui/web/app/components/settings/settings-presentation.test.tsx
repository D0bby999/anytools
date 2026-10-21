import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Form, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { LanguageChoice } from "./language-choice";
import { OwnVersionSetting } from "./own-version-setting";
import { RouteChainDialog, moveRow } from "./route-chain-dialog";
import type { Connection } from "~/lib/byok.types";
import Settings from "~/routes/settings";
import { NAV_TREE } from "~/lib/nav-tree";

beforeAll(() => initI18n("en"));
function routed(element: React.ReactNode, posts: Record<string, FormDataEntryValue>[] = []) {
  const router = createMemoryRouter([
    {
      path: "/",
      element,
      action: async ({ request }) => {
        posts.push(Object.fromEntries(await request.formData()));
        return {};
      },
    },
  ]);
  return render(<RouterProvider router={router} />);
}

function chainDialog() {
  const connections = [
    { id: "a", name: "Primary", provider: "openai" },
    { id: "b", name: "Backup", provider: "cerebras" },
  ] as Connection[];
  return (
    <RouteChainDialog
      fn="chat"
      entries={[
        { connection_id: "a", model: "first" },
        { connection_id: "b", model: "second" },
      ]}
      connections={connections}
      catalog={[]}
      maxEntries={3}
    />
  );
}

describe("Settings controls preserve form contracts", () => {
  it("posts the chosen language and language intent", async () => {
    const posts: Record<string, FormDataEntryValue>[] = [];
    routed(
      <Form method="post">
        <input type="hidden" name="intent" value="language" />
        <LanguageChoice language="en" label="Language" names={{ en: "English", vi: "Tiếng Việt", es: "Español", pt: "Português" }} />
        <button type="submit">Save</button>
      </Form>,
      posts,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Tiếng Việt" }));
    expect(screen.getByRole("radio", { name: "Tiếng Việt" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toEqual([{ intent: "language", language: "vi" }]));
  });
  it("posts the opposite own-version setting through the switch", async () => {
    const posts: Record<string, FormDataEntryValue>[] = [];
    routed(<OwnVersionSetting on pending={false} saved={false} failed="" />, posts);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await waitFor(() => expect(posts).toEqual([{ intent: "own_version", enabled: "false" }]));
  });
  it("moves edited connection/model pairs together and saves their new positions", async () => {
    const posts: Record<string, FormDataEntryValue>[] = [];
    routed(chainDialog(), posts);
    await userEvent.click(screen.getByRole("button", { name: "Edit the Chat chain" }));
    const models = screen.getAllByRole("combobox", { name: /^Model at position/ });
    await userEvent.clear(models[1]!);
    await userEvent.type(models[1]!, "edited");
    expect(screen.getByRole("button", { name: "Move position 1 up" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move position 2 up" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(posts).toEqual([{ function: "chat", connection_0: "b", model_0: "edited", connection_1: "a", model_1: "first" }]),
    );
  });
  it("reorders the chain from the keyboard: Alt+arrow on a row's handle, said aloud", async () => {
    const posts: Record<string, FormDataEntryValue>[] = [];
    routed(chainDialog(), posts);
    await userEvent.click(screen.getByRole("button", { name: "Edit the Chat chain" }));
    const handle = screen.getByRole("button", { name: "Drag or press Alt+arrow to move position 2" });
    handle.focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(screen.getByRole("status")).toHaveTextContent("Moved from position 2 to 1");
    // An arrow without Alt does nothing, so a handle can be tabbed past.
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(posts).toEqual([{ function: "chat", connection_0: "b", model_0: "second", connection_1: "a", model_1: "first" }]),
    );
  });
  it("moveRow moves one row and leaves an out-of-range move alone", () => {
    expect(moveRow(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveRow(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
  it("orders all seven tabs by NAV_TREE", () => {
    routed(<Settings />);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      NAV_TREE.find((group) => group.id === "settings")!.items.map((page) => page.to),
    );
  });
});

it("confirms credential deletion in a dialog and returns focus to Manage on cancel", async () => {
  const { ConnectionCard } = await import("./connection-card");
  const { within } = await import("@testing-library/react");
  const posts: Record<string, FormDataEntryValue>[] = [];
  routed(
    <ul>
      <ConnectionCard
        connection={{
          id: "c",
          provider: "openai",
          kind: "api_key",
          name: "My key",
          api_base: "",
          has_secret: true,
          created_at: "2026-10-20",
        }}
      />
    </ul>,
    posts,
  );
  const manage = screen.getByRole("button", { name: "Manage" });
  await userEvent.click(manage);
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  let dialog = screen.getByRole("dialog", { name: "Remove" });
  expect(posts).toEqual([]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(manage).toHaveFocus());
  await userEvent.click(manage);
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  dialog = screen.getByRole("dialog", { name: "Remove" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(posts).toEqual([{ intent: "delete", id: "c" }]));
});
