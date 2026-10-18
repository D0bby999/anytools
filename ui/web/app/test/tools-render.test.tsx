/**
 * tools-render.test.tsx
 * AnyTools phase 2: every ported tool renders, through the same frame its
 * page uses (lazy chunk, locale provider, error boundary), in English and in
 * one other language. Phase 3 grows this by porting tools: the list comes
 * from the UI registry, not from this file.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ToolFrame } from "~/components/tools-site/tool-frame";
import { toolsI18n } from "~/lib/tools/i18n";
import type { ToolsMessages } from "~/lib/tools/i18n";
import viTools from "../../public/locales/vi/tools.json";
import { toolMetas } from "~/tools/meta-registry";
import { TOOL_UIS, isPorted } from "~/tools/ui-registry";

const ported = Object.keys(TOOL_UIS).sort();
const TOOLS_DIR = resolve(process.cwd(), "app/tools");
const portedIn = (...clusters: string[]) =>
  ported.filter((s) => clusters.includes(toolMetas.find((m) => m.slug === s)?.cluster ?? ""));

describe("the UI registry", () => {
  it("names only tools in the meta registry", () => {
    const slugs = new Set(toolMetas.map((m) => m.slug));
    expect(ported.filter((s) => !slugs.has(s))).toEqual([]);
  });

  it("lists every tool folder that has a UI, so no ported tool is left unreachable", () => {
    const withUi = readdirSync(TOOLS_DIR).filter((d) => existsSync(join(TOOLS_DIR, d, "ui.tsx"))).sort();
    expect(ported).toEqual(withUi);
  });

  // Each batch adds its own list; together with the folder check above, nothing is left out
  // and nothing is registered twice.
  it("holds the first eight: time-date and web3", () => {
    expect(ported).toEqual(expect.arrayContaining([
      "bip39-mnemonic",
      "cron-parser",
      "crontab-generator",
      "discord-timestamp-generator",
      "eth-wei-converter",
      "timestamp-converter",
      "timezone-converter",
      "wallet-checker",
    ]));
  });

  it("holds batch A (phase 3a): converters, finance, health, lifestyle", () => {
    const batchA = [
      "age-calculator",
      "audio-trim",
      "bmi-calculator",
      "bmr-calculator",
      "body-fat-calculator",
      "calorie-calculator",
      "chmod-calculator",
      "compound-interest",
      "create-zip",
      "csv-json",
      "curl-converter",
      "currency-converter",
      "date-diff",
      "discount-calculator",
      "docx-to-markdown",
      "font-converter",
      "gpa-calculator",
      "grade-calculator",
      "image-format-converter",
      "image-to-base64",
      "ip-subnet-calculator",
      "json-yaml-toml",
      "loan-calculator",
      "md-html",
      "mortgage-calculator",
      "msgpack-decoder",
      "pace-calculator",
      "percentage-calculator",
      "pomodoro-timer",
      "pregnancy-due-date",
      "protobuf-decoder",
      "random-picker",
      "readability-analyzer",
      "reading-time",
      "retirement-calculator",
      "roman-numeral-converter",
      "sales-tax-calculator",
      "scientific-calculator",
      "shoe-size-converter",
      "sleep-calculator",
      "statistics-calculator",
      "time-card-calculator",
      "tip-calculator",
      "tip-to-hourly-wage",
      "triangle-calculator",
      "unit-converter",
      "unzip-archive",
      "word-counter",
      "xlsx-to-csv",
    ];
    expect(batchA).toHaveLength(49);
    expect(ported).toEqual(expect.arrayContaining(batchA));
    const clusters = new Set(toolMetas.filter((m) => batchA.includes(m.slug)).map((m) => m.cluster));
    expect([...clusters].sort()).toEqual(["converters", "finance", "health", "lifestyle"]);
    // Every tool of those four clusters is in the batch.
    expect(toolMetas.filter((m) => clusters.has(m.cluster)).map((m) => m.slug).sort()).toEqual(batchA);
  });

  it("holds batch B: every encoding, formatters, generators and text-regex tool", () => {
    const batchB = toolMetas
      .filter((m) => ["encoding", "formatters", "generators", "text-regex"].includes(m.cluster))
      .map((m) => m.slug);
    expect(batchB).toHaveLength(43);
    expect(batchB.filter((s) => !isPorted(s))).toEqual([]);
  });

  it("holds batch C: every pdf, image and design tool", () => {
    const batch = ["pdf", "image", "design"];
    const all = toolMetas.filter((m) => batch.includes(m.cluster)).map((m) => m.slug).sort();
    expect(all).toHaveLength(31);
    expect(portedIn(...batch)).toEqual(all);
  });
});

describe.each(ported)("%s", (slug) => {
  it.each(["en", "vi"] as const)("renders in %s", async (locale) => {
    const i18n = toolsI18n(locale, locale === "en" ? null : (viTools as ToolsMessages));
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ToolFrame slug={slug} locale={locale} />
      </I18nextProvider>,
    );
    // The lazy chunk resolves, then the tool replaces the loading line.
    await waitFor(() => expect(screen.queryByRole("status")?.textContent ?? "").not.toMatch(/Loading|Đang tải/), {
      timeout: 15_000,
    });
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toMatch(/did not load|chưa tải/);
    expect(container.querySelectorAll("input, textarea, button, select, [role='combobox']").length).toBeGreaterThan(0);
    // The test's own limit matches its waitFor's: the first import of a tool
    // chunk can take seconds when the whole suite runs at once.
  }, 20_000);
});

describe("a tool that is not ported", () => {
  it("is none of the registry's: phase 3 ported all 131", () => {
    expect(toolMetas).toHaveLength(131);
    expect(toolMetas.filter((m) => !isPorted(m.slug)).map((m) => m.slug)).toEqual([]);
  });

  it("says it is coming back, and loads nothing", () => {
    render(
      <I18nextProvider i18n={toolsI18n("en", null)}>
        <ToolFrame slug="not-a-ported-tool" locale="en" />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Coming back soon");
  });
});
