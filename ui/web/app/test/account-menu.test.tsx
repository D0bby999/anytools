/**
 * account-menu.test.tsx
 * The running head's account: one round button holding who is signed in,
 * Settings, the language and a POST sign-out (plan 261019-1317, phase 3).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { AccountMenu, initials } from "~/components/layout/account-menu";

const i18n = initI18n();

describe("the account menu", () => {
  it("draws initials from the name, else the email", () => {
    expect(initials("Nguyễn Văn An", "a@b.c")).toBe("NA");
    expect(initials("Owner", "a@b.c")).toBe("OW");
    expect(initials("", "chau@example.com")).toBe("C");
  });

  it("holds the account, Settings, the language and a POST sign-out", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <AccountMenu displayName="Local owner" email="owner@anytools.local" /> }],
      { initialEntries: ["/"] },
    );
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    // Named by text, with the initials shown and hidden from the name (WCAG 2.5.3).
    const summary = container.querySelector("summary");
    expect(summary?.hasAttribute("aria-label")).toBe(false);
    expect(summary?.querySelector(".sr-only")?.textContent).toBe("Account: Local owner");
    expect(screen.getByText("owner@anytools.local")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: "Language" }).getAttribute("href")).toBe("/settings/account");
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/auth/logout");
  });
});
