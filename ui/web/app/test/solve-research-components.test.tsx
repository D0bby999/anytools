/**
 * solve-research-components.test.tsx
 *
 * Phase 9's rendering contracts: a web citation opens the page it was gathered
 * from and nothing else; a report mixing chunk and url citations resolves both
 * kinds; staged progress reads the server's own stage events; and a user with
 * no search key is told "KB-only" in words before they start.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { CitationChip, safeWebURL } from "~/components/chat/citation-chip";
import { CitedBody } from "~/components/research/cited-body";
import { StageList } from "~/components/research/stage-list";
import { KBOnlyBadge } from "~/components/research/report-list";
import { LiveReport } from "~/components/research/live-report";
import { RESEARCH_STAGES, kbOnlyReasonKey } from "~/lib/research-types";

beforeAll(() => {
  initI18n("en");
});

function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

describe("url citation chips", () => {
  it("open the gathered page in a new tab with no opener and no referrer", () => {
    renderRouted(
      <CitationChip index={2} source={{ kind: "url", id: "1", title: "RAG paper", url: "https://arxiv.org/abs/2005.11401" }} />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/2005.11401");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link).toHaveAccessibleName("Open RAG paper (arxiv.org) in a new tab");
  });

  it("never renders a non-http URL as a link", () => {
    renderRouted(
      <CitationChip index={1} source={{ kind: "url", id: "1", title: "Evil", url: "javascript:alert(1)" }} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(safeWebURL("data:text/html,x")).toBeNull();
    expect(safeWebURL("https://ok.test/a")).toBe("https://ok.test/a");
  });
});

describe("CitedBody", () => {
  it("resolves chunk and url markers independently, even with the same id", () => {
    renderRouted(
      <CitedBody
        text={"Local claim [[cite:chunk:1]]. Web claim [[cite:url:1]]. Invented [[cite:url:9]]."}
        sources={[
          { kind: "chunk", id: "1", title: "Notes.pdf", page: 3, document_id: "doc-1" },
          { kind: "url", id: "1", title: "Page", url: "https://example.org/p" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/documents/doc-1?page=3",
      "https://example.org/p",
    ]);
    expect(document.body.textContent).not.toContain("[[cite:");
  });
});

describe("StageList", () => {
  it("marks each stage from the server's own events, in words", () => {
    render(
      <StageList ns="research" stages={RESEARCH_STAGES} current="gather" done={["rephrase", "decompose"]} finished={false} />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Framing the questionDone",
      "Splitting it into sub-questionsDone",
      "Gathering sourcesIn progress",
      "Writing the reportWaiting",
      "Checking claims against sourcesWaiting",
    ]);
  });
});

describe("KB-only", () => {
  it("says KB-only in words and why", () => {
    render(<KBOnlyBadge reason="no_search_key" />);
    const badge = screen.getByText("KB-only");
    expect(badge).toHaveAttribute("title", "KB-only: no web search key is connected.");
    expect(kbOnlyReasonKey("web_off_with_documents")).toBe("kbOnly.webOff");
  });

  it("a live KB-only report shows the turn's own note and the reason", () => {
    renderRouted(
      <LiveReport
        text="# Report"
        sources={[]}
        streaming={false}
        observations={["no web search key is connected, so this report uses your knowledge base only"]}
        meta={{ report_id: "r1", kb_only: true, kb_only_reason: "no_search_key" }}
      />,
    );
    expect(screen.getByText(/no web search key is connected, so this report/)).toBeInTheDocument();
    expect(screen.getByText("KB-only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the report" })).toHaveAttribute("href", "/research/r1");
  });
});
