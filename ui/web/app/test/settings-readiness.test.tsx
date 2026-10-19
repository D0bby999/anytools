/**
 * settings-readiness.test.tsx
 *
 * The readiness surface is the product's honest self-report, so what it SAYS is
 * behaviour: a green pill on a resting connection, or a status carried by colour
 * alone, are both bugs a screenshot review would pass.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { initI18n } from "~/lib/i18n";
import { ReadinessMatrix, StatusPill } from "~/components/settings/readiness-matrix";
import { ReadinessCard } from "~/components/settings/readiness-card";
import { connectionStatus } from "~/components/settings/connection-card";
import type { Connection, FunctionReadiness, Readiness } from "~/lib/byok.types";

const i18n = initI18n();

function renderWithRouter(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: <>{element}</> }], {
    initialEntries: ["/"],
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const row = (over: Partial<FunctionReadiness>): FunctionReadiness => ({
  function: "chat",
  status: "green",
  reason: "",
  entries: [],
  ...over,
});

describe("the readiness matrix", () => {
  it("names every routed connection in chain order", () => {
    renderWithRouter(
      <ReadinessMatrix
        functions={[
          row({
            function: "chat",
            entries: [
              { connection_id: "1", name: "Primary", provider: "gemini", model: "gemini-2.5-flash", status: "green" },
              { connection_id: "2", name: "Backup", provider: "openai", model: "gpt-4o-mini", status: "green" },
            ],
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    const text = items.map((el) => el.textContent ?? "").join("|");
    expect(text.indexOf("Primary")).toBeLessThan(text.indexOf("Backup"));
    expect(screen.getByText("gemini-2.5-flash")).toBeTruthy();
  });

  it("shows the reason for anything that is not green", () => {
    renderWithRouter(
      <ReadinessMatrix
        functions={[
          row({ function: "embed", status: "blocked", reason: "No embed route. Choose a connection for it in Settings → Routes." }),
          row({ function: "research", status: "warn", reason: "No search key: research runs KB-only." }),
        ]}
      />,
    );
    expect(screen.getByText(/No embed route/)).toBeTruthy();
    expect(screen.getByText(/research runs KB-only/)).toBeTruthy();
  });

  it("never carries a status by colour alone", () => {
    // DESIGN.md's anti-pattern list names colour-only meaning explicitly, and a
    // tint is exactly what disappears in forced high-contrast mode.
    for (const status of ["green", "warn", "blocked"] as const) {
      const { unmount } = render(<StatusPill status={status} label={`label-${status}`} />);
      expect(screen.getByText(`label-${status}`)).toBeTruthy();
      unmount();
    }
  });
});

describe("the readiness card on Home", () => {
  const readiness = (over: Partial<Readiness>): Readiness => ({
    core: "green",
    // The card filters on this rather than on a list of its own, so the fixture
    // has to supply it — which is the point: one definition, in Go.
    core_functions: ["chat", "parse", "embed"],
    lanes_enabled: false,
    functions: [
      row({ function: "chat" }),
      row({ function: "parse" }),
      row({ function: "embed" }),
      row({ function: "rerank", status: "blocked", reason: "No rerank route." }),
    ],
    ...over,
  });

  it("says nothing once everything core works", () => {
    const { container } = renderWithRouter(<ReadinessCard readiness={readiness({})} />);
    expect(container.querySelector("section")).toBeNull();
  });

  it("names only the core capabilities that cannot run, in plain words", () => {
    renderWithRouter(
      <ReadinessCard
        readiness={readiness({
          core: "blocked",
          functions: [
            row({ function: "chat" }),
            row({ function: "parse", status: "blocked", reason: "No parse route.", reason_code: "no_route" }),
            row({ function: "embed" }),
            row({ function: "rerank", status: "blocked", reason: "No rerank route." }),
          ],
        })}
      />,
    );
    // rerank is blocked but invisible to the user, so putting it on the landing
    // card would teach them to ignore the card.
    expect(screen.queryByText(/rerank/i)).toBeNull();
    expect(screen.queryByText("Chat")).toBeNull();
    expect(screen.getByText("Read documents")).toBeTruthy();
    expect(screen.getByText(/One more step/)).toBeTruthy();
    // No engineering status word on Home: that is the matrix's, in Settings.
    expect(screen.queryByText(/Blocked/)).toBeNull();
    // A missing route is chosen on the Routes page.
    expect(screen.getByRole("link", { name: /Fix it in Settings/ }).getAttribute("href")).toBe("/settings/routes");
  });

  it("says it does not know when the API was unreachable", () => {
    renderWithRouter(<ReadinessCard readiness={null} />);
    // The failure mode this prevents: silence read as "all is well".
    expect(screen.getByText(/could not reach its API/)).toBeTruthy();
  });
});

describe("a connection's own status", () => {
  const base: Connection = {
    id: "1",
    provider: "gemini",
    kind: "api_key",
    name: "mine",
    api_base: "",
    has_secret: true,
    created_at: "2026-09-17T00:00:00Z",
  };

  it("is not green until something has verified it", () => {
    expect(connectionStatus(base)).toBe("warn");
    expect(connectionStatus({ ...base, verified_at: "2026-09-17T00:00:00Z" })).toBe("green");
  });

  it("is a warning while resting and a block when rejected", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      connectionStatus({ ...base, verified_at: "2026-09-17T00:00:00Z", cooldown_until: future }),
    ).toBe("warn");
    expect(connectionStatus({ ...base, last_error: "The provider rejected this key." })).toBe("blocked");
    expect(connectionStatus({ ...base, needs_reconnect: true })).toBe("blocked");
  });

  it("treats an expired cooldown as over", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      connectionStatus({ ...base, verified_at: "2026-09-17T00:00:00Z", cooldown_until: past }),
    ).toBe("green");
  });
});

describe("the Settings surface as a whole", () => {
  const APP = join(resolve(process.cwd()), "app");

  it("every section the Settings nav offers is a registered route", () => {
    const routes = readFileSync(join(APP, "routes.ts"), "utf8");
    const settings = readFileSync(join(APP, "routes/settings.tsx"), "utf8");
    const destinations = [...settings.matchAll(/to: "(\/settings[^"]*)"/g)].map((m) => m[1] ?? "");

    expect(destinations.length).toBeGreaterThan(0);
    for (const dest of destinations) {
      const leaf = dest.replace("/settings", "").replace(/^\//, "");
      if (leaf === "") {
        expect(routes).toMatch(/index\("routes\/settings\.connections\.tsx"\)/);
        continue;
      }
      expect(routes, `no route registered for ${dest}`).toContain(`"${leaf}"`);
    }
  });

  it("no Settings component imports a server module", () => {
    // Duplicates the global structural guard on purpose: this is the directory
    // where a `.server` import is most tempting, because the API helpers and
    // the types live next to each other.
    for (const file of [
      "components/settings/readiness-matrix.tsx",
      "components/settings/readiness-card.tsx",
      "components/settings/connection-card.tsx",
      "components/settings/subscription-lane-card.tsx",
      "components/settings/route-chain-editor.tsx",
    ]) {
      const src = readFileSync(join(APP, file), "utf8");
      expect(src, `${file} imports a server module`).not.toMatch(/from\s+["'][^"']*\.server["']/);
    }
  });

  it("the experimental warning is present in the copy and is not optional", () => {
    const bundle = JSON.parse(
      readFileSync(join(resolve(process.cwd()), "public/locales/en/common.json"), "utf8"),
    );
    const warning: string = bundle.settings.experimental.warning;
    // The three facts a user cannot guess from the outside, and which the phase
    // requires be said: unofficial, the account may be restricted, and the
    // Google scope is broad.
    expect(warning).toMatch(/unofficial/i);
    expect(warning).toMatch(/restricted/i);
    expect(warning).toMatch(/Google Cloud/i);
    expect(warning).toMatch(/API key/i);

    const card = readFileSync(join(APP, "components/settings/subscription-lane-card.tsx"), "utf8");
    // Rendered as an Alert above the forms, never inside a <details> a user can
    // ship without opening.
    expect(card).toMatch(/<Alert[^>]*variant="destructive"/);
    expect(card).not.toMatch(/<details/);
  });
});

describe("the readiness matrix has a production mount point", () => {
  const APP = join(resolve(process.cwd()), "app");

  it("a Settings route renders it", () => {
    // It was possible to build, test and ship this component while no route
    // rendered it — three passing tests against a screen nobody could open.
    // This asserts a real caller exists.
    const sources = ["routes/settings.routes.tsx", "routes/settings.connections.tsx", "routes/settings.search.tsx"]
      .map((f) => readFileSync(join(APP, f), "utf8"))
      .join("\n");

    expect(sources, "no Settings route imports ReadinessMatrix").toMatch(/ReadinessMatrix/);
    expect(sources, "no Settings route fetches readiness").toMatch(/getReadiness/);
  });
});
