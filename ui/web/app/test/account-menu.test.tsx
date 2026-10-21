/**
 * account-menu.test.tsx
 * The nav's account: one round button opening a flyout with who is signed
 * in, Settings, the language and a POST sign-out (plan 261020-2246, phase 3).
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    const button = screen.getByRole("button", { name: "Account: Local owner" });
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.querySelector(".sr-only")?.textContent).toBe("Account: Local owner");
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe("LO");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("owner@anytools.local")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: "Language" }).getAttribute("href")).toBe("/settings/account");
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/auth/logout");
    // Escape closes it and gives focus back to the button.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
    expect(container.querySelector("[hidden]")).not.toBeNull();
  });

  it("closes on a click outside", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <><AccountMenu displayName="A B" email="a@b.c" /><p>outside</p></> }],
      { initialEntries: ["/"] },
    );
    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    const button = screen.getByRole("button", { name: "Account: A B" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
