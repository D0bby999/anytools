/**
 * research-quality.test.tsx — the claim check, open questions, "keep
 * studying", and the keyless-search notice on the research form.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useFetcher } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ClaimCheck } from "~/components/research/claim-check";
import { KeepStudying, OpenQuestions } from "~/components/research/keep-studying";
import { ResearchForm } from "~/components/research/research-form";
import type { Verification } from "~/lib/research-types";

beforeAll(async () => {
  await initI18n();
});

function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

const sources = [
  { kind: "url" as const, id: "1", title: "Forgetting curve", url: "https://en.wikipedia.org/wiki/Forgetting_curve" },
  { kind: "url" as const, id: "2", title: "Blog", url: "https://blog.example/post" },
];

const check: Verification = {
  status: "checked",
  total: 3,
  supported: 1,
  partial: 1,
  unsupported: 1,
  uncited: 0,
  claims: [
    { claim: "Spacing helps.", cites: ["url:1"], verdict: "supported" },
    { claim: "Retention doubles in a week.", cites: ["url:2"], verdict: "unsupported", note: "The page gives no figure." },
    { claim: "It works for everyone.", cites: ["url:1"], verdict: "partial", note: "Only for adults." },
  ],
};

describe("claim check", () => {
  it("leads with the claims to check, each with a verdict in words and its source chip", () => {
    renderRouted(<ClaimCheck check={check} sources={sources} />);
    expect(screen.getByText("1 of 3 claims are supported by the sources they cite.")).toBeTruthy();
    expect(screen.getByText(/not proof that a claim is true/)).toBeTruthy();
    // The flagged claims are the rows of the table under "Needs checking"
    // (the header row aside), in the order the check gave them.
    const flagged = screen.getByText("Needs checking").nextElementSibling as HTMLElement;
    const items = within(flagged).getAllByRole("row").slice(1);
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Not in the source"),
      expect.stringContaining("Partly supported"),
    ]);
    const first = items[0]!;
    expect(within(first).getByText("The page gives no figure.")).toBeTruthy();
    expect(within(first).getByRole("link").getAttribute("href")).toBe("https://blog.example/post");
  });

  it("says so plainly when every claim is supported, or when the check could not run", () => {
    const all: Verification = { ...check, supported: 1, partial: 0, unsupported: 0, total: 1, claims: [check.claims[0]!] };
    const { unmount } = renderRouted(<ClaimCheck check={all} sources={sources} />);
    expect(screen.getByText("Every checked claim is supported by the source it cites.")).toBeTruthy();
    expect(screen.queryByText("Needs checking")).toBeNull();
    unmount();
    renderRouted(<ClaimCheck check={{ ...check, status: "unavailable", claims: [] }} sources={sources} />);
    expect(screen.getByText(/could not run for this report/)).toBeTruthy();
  });
});

describe("open questions", () => {
  it("turns each gap into a prefilled research question", () => {
    renderRouted(<OpenQuestions questions={["spacing for skills & motor learning"]} />);
    expect(screen.getByRole("link", { name: "Research this" }).getAttribute("href")).toBe(
      "/research?q=spacing%20for%20skills%20%26%20motor%20learning",
    );
  });

  it("renders nothing when nothing is open", () => {
    const { container } = renderRouted(<OpenQuestions questions={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("keep studying", () => {
  it("offers the learner's knowledge bases and the cited pages", () => {
    const { container } = renderRouted(<KeepStudying kbs={[{ id: "kb-1", name: "Memory" }]} hasWebSources />);
    expect(container.querySelector('input[name="intent"]')?.getAttribute("value")).toBe("to-kb");
    expect(screen.getByRole("option", { name: "Memory" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /web pages it cites/ })).toBeTruthy();
  });

  it("points to Knowledge when there is no knowledge base yet", () => {
    renderRouted(<KeepStudying kbs={[]} hasWebSources={false} />);
    expect(screen.getByRole("link", { name: "Create one" }).getAttribute("href")).toBe("/knowledge");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

function FormHarness(props: { webAvailable: boolean; webKeyless?: boolean; defaultQuery?: string }) {
  const fetcher = useFetcher();
  return <ResearchForm fetcher={fetcher} kbs={[]} busy={false} onStop={() => {}} {...props} />;
}

describe("research form", () => {
  it("says the web goes through DuckDuckGo when there is no key, and prefills a question", () => {
    renderRouted(<FormHarness webAvailable webKeyless defaultQuery="what is interleaving" />);
    expect(screen.getByText(/searched through DuckDuckGo/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect a search key" })).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("what is interleaving");
  });

  it("still says KB-only when the fallback is off and there is no key", () => {
    renderRouted(<FormHarness webAvailable={false} />);
    expect(screen.getByText(/knowledge base only \(KB-only\)/)).toBeTruthy();
  });
});
