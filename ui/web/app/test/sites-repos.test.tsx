/**
 * sites-repos.test.tsx
 *
 * Documentation sites and GitHub repositories (up-methods phase 18): the two
 * forms send what the learner chose, the sources list shows a crawl's
 * progress, its pages and what is gone from the site, and a code passage's
 * citation reads as a line range.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { AddSite } from "~/components/knowledge/add-site";
import { AddRepo } from "~/components/knowledge/add-repo";
import { KbSources } from "~/components/knowledge/kb-sources";
import { CitationChip } from "~/components/chat/citation-chip";
import { crawlPercent, splitList, type Repo, type Site } from "~/lib/sources-types";

beforeAll(() => {
  initI18n("en");
});

const limits = { default_depth: 2, max_depth: 3, default_pages: 50, max_pages: 200 };
const defaults = {
  doc_extensions: [".md", ".mdx", ".rst", ".txt", ".adoc"],
  code_extensions: [".go", ".py", ".ts"],
  max_file_bytes: 2 << 20,
  max_files: 2000,
  max_repo_bytes: 100 << 20,
};

function renderWith(element: ReactElement, posts: [string, string][][], loads: string[] = []) {
  const router = createMemoryRouter(
    [
      { path: "/", element },
      {
        path: "/app/api/sources",
        loader: ({ request }) => {
          loads.push(new URL(request.url).search);
          return {
            ok: true,
            pages: [
              { url: "https://docs.example.com/guide/", depth: 0, ord: 0, status: "added", document_id: "d1", title: "Guide" },
              { url: "https://docs.example.com/guide/old", depth: 1, status: "removed", document_id: "d2", title: "Old page",
                removed_at: "2026-10-16T00:00:00Z", reason: "no longer linked from the site" },
              { url: "https://docs.example.com/guide/private", depth: 1, ord: 1, status: "skipped",
                reason: "the site's robots.txt asks tools like AnyTools not to read this page" },
            ],
          };
        },
        action: async ({ request }) => {
          posts.push([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
          return { ok: true, intent: "x", title: "Guide" };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const site: Site = {
  id: "s1", kb_id: "kb1", start_url: "https://docs.example.com/guide/", path_prefix: "/guide/", max_depth: 1,
  max_pages: 50, title: "Guide", status: "crawling", generation: 1, found: 8, done: 2, documents: 2, removed: 1,
};
const repo: Repo = {
  id: "r1", kb_id: "kb1", owner: "acme", name: "docs", branch: "", resolved_branch: "main", path_prefix: "docs",
  extensions: [".md"], ignore_paths: [], status: "ready", commit_sha: "0123456789abcdef0123456789abcdef01234567",
  file_count: 12, removed: 1, note: "3 files over 2 MB or not text were skipped.",
};

describe("Add a site", () => {
  it("sends the start URL with the default depth and page limit", async () => {
    const posts: [string, string][][] = [];
    renderWith(<AddSite kbId="kb1" limits={limits} />, posts);
    expect(screen.getByLabelText("Link depth")).toHaveValue(2);
    expect(screen.getByLabelText("Page limit")).toHaveValue(50);
    await userEvent.type(screen.getByLabelText("Documentation site start page"), "https://docs.example.com/guide/");
    await userEvent.click(screen.getByRole("button", { name: "Add site" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(Object.fromEntries(posts[0] ?? [])).toEqual({
      intent: "add-site", kb: "kb1", url: "https://docs.example.com/guide/", depth: "2", pages: "50",
    });
    expect(await screen.findByText(/Started reading “Guide”/)).toBeInTheDocument();
  });
});

describe("Add a repository", () => {
  it("ticks documentation types by default and sends code types only when chosen", async () => {
    const posts: [string, string][][] = [];
    renderWith(<AddRepo kbId="kb1" defaults={defaults} />, posts);
    expect(screen.getByRole("checkbox", { name: ".md" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: ".go" })).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("GitHub repository"), "https://github.com/acme/docs");
    await userEvent.type(screen.getByLabelText("Folder"), "docs");
    await userEvent.click(screen.getByRole("checkbox", { name: ".go" }));
    await userEvent.type(screen.getByLabelText(/Paths to skip/), "drafts/");
    await userEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const sent = posts[0] ?? [];
    expect(sent.filter(([k]) => k === "ext").map(([, v]) => v)).toEqual([".md", ".mdx", ".rst", ".txt", ".adoc", ".go"]);
    expect(Object.fromEntries(sent)).toMatchObject({ intent: "add-repo", kb: "kb1", path: "docs", ignore: "drafts/" });
  });
});

describe("Sites and repositories", () => {
  it("shows a crawl's progress and its pages, with removed pages marked", async () => {
    const loads: string[] = [];
    renderWith(<KbSources sites={[site]} repos={[repo]} />, [], loads);
    const bar = screen.getByRole("progressbar", { name: "Reading Guide" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/2 of 8 pages read · 2 documents/)).toBeInTheDocument();
    expect(screen.getByText(/1 page removed from the site/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show pages" }));
    expect(await screen.findByRole("link", { name: "Guide" })).toHaveAttribute("href", "/documents/d1");
    expect(loads[0]).toBe("?site=s1");
    const old = screen.getByRole("link", { name: "Old page" }).closest("li") as HTMLElement;
    expect(within(old).getByText("Removed from the site")).toBeInTheDocument();
    expect(screen.getByText(/Skipped · the site's robots.txt/)).toBeInTheDocument();

    expect(screen.getByText("acme/docs")).toBeInTheDocument();
    expect(screen.getByText(/main @ 0123456/)).toBeInTheDocument();
    expect(screen.getByText(/12 files · 1 file removed from the repository/)).toBeInTheDocument();
  });

  it("re-syncs and cancels by id", async () => {
    const posts: [string, string][][] = [];
    renderWith(<KbSources sites={[site]} repos={[]} />, posts);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(Object.fromEntries(posts[0] ?? [])).toEqual({ intent: "cancel-site", id: "s1" });
    // A crawl in flight cannot be re-synced on top of itself.
    expect(screen.getByRole("button", { name: "Re-sync" })).toBeDisabled();
  });
});

describe("helpers and citations", () => {
  it("computes progress and splits typed lists", () => {
    expect(crawlPercent({ ...site, status: "ready" })).toBe(100);
    expect(crawlPercent({ ...site, found: 0 })).toBe(0);
    expect(splitList(" .proto, .graphql\n.sql ")).toEqual([".proto", ".graphql", ".sql"]);
  });

  it("cites a code passage by line range and opens the whole file", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <CitationChip index={1} source={{ kind: "chunk", id: "c1", title: "memory.go", page: 40, line_end: 72, document_id: "d9" }} /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    const chip = screen.getByRole("link", { name: "Open memory.go, lines 40–72" });
    expect(chip).toHaveAttribute("href", "/documents/d9");
  });
});
