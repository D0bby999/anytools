/**
 * subscription-signin.test.tsx — the Copilot and Claude cards carry a started
 * sign-in into their second step, and never render without the lanes'
 * warning above them.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { initI18n } from "~/lib/i18n";
import { SubscriptionLaneCards } from "~/components/settings/subscription-lane-card";

const i18n = initI18n();

function renderCards(props: Partial<Parameters<typeof SubscriptionLaneCards>[0]>) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <SubscriptionLaneCards enabled geminiRedirectURI="" geminiAuthURL={null} {...props} />,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("subscription sign-in cards", () => {
  it("offers to start each sign-in, under the warning", () => {
    const { container } = renderCards({});
    expect(screen.getByRole("alert")).toBeTruthy();
    const intents = [...container.querySelectorAll('input[name="intent"]')].map((i) => (i as HTMLInputElement).value);
    expect(intents).toContain("copilot-start");
    expect(intents).toContain("claude-start");
  });

  it("shows the GitHub code and carries the sign-in into the finish form", () => {
    const { container } = renderCards({
      copilot: { session_id: "s1", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device" },
    });
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    const finish = container.querySelector('input[value="copilot-finish"]')?.closest("form");
    expect(finish?.querySelector<HTMLInputElement>('input[name="session_id"]')?.value).toBe("s1");
  });

  it("links to Claude's approval page and asks for the code", () => {
    const { container } = renderCards({ claude: { session_id: "s2", authorize_url: "https://claude.ai/oauth/authorize?x=1" } });
    const link = container.querySelector('a[href="https://claude.ai/oauth/authorize?x=1"]');
    expect(link?.getAttribute("rel")).toContain("noopener");
    const finish = container.querySelector('input[value="claude-finish"]')?.closest("form");
    expect(finish?.querySelector('input[name="code"]')).toBeTruthy();
    expect(finish?.querySelector<HTMLInputElement>('input[name="session_id"]')?.value).toBe("s2");
  });

  it("renders nothing while the lanes are off", () => {
    const { container } = renderCards({ enabled: false });
    expect(container.querySelector('input[value="copilot-start"]')).toBeNull();
  });
});
