/**
 * settings-search-zotero.test.tsx
 *
 * Settings → Search keys (up-methods phase 20): choosing "zotero" asks for
 * the library's numeric user ID beside the key, and both are posted; other
 * providers are not asked for one.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import SearchKeys from "~/routes/settings.search";

beforeAll(() => {
  initI18n("en");
});

type Props = Parameters<typeof SearchKeys>[0];

function renderPage(posts: Record<string, string>[]) {
  const props = {
    loaderData: { search_connections: [], providers: ["tavily", "brave", "openalex", "github", "zotero"], keyless_fallback: true },
    actionData: undefined,
    params: {},
    matches: [],
  } as unknown as Props;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <SearchKeys {...props} />,
        action: async ({ request }) => {
          posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return { message: null };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Search keys: Zotero", () => {
  it("asks for the Zotero user ID only for zotero, and posts it with the key", async () => {
    const posts: Record<string, string>[] = [];
    renderPage(posts);
    expect(screen.queryByLabelText(/Zotero user ID/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "zotero");
    await userEvent.type(screen.getByLabelText(/Zotero user ID/), "475425");
    await userEvent.type(document.querySelector<HTMLInputElement>('input[name="secret"]')!, "KEY0FIXTURE0000000000000");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ intent: "save", provider: "zotero", zotero_user: "475425" });
  });
});
