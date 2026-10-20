/**
 * llms[.]txt.ts
 * The site in one plain file for language models and agents that read it
 * (llmstxt.org): what AnyTools and AnyLearn are, then every indexable tool
 * with its English page. In English only, as the format expects; each page
 * names its vi, es and pt versions through hreflang.
 */
import { APP_URL } from "~/lib/env.server";
import { POPULATED_CLUSTERS, toolDescription, toolTitle } from "~/lib/tools/catalog";
import { isIndexableTool } from "~/lib/tools/content.server";
import { listGuides } from "~/lib/tools/pages.server";
import { toolsT } from "~/lib/tools/route.server";
import { toolMetas } from "~/tools/meta-registry";

export function loader() {
  const t = toolsT("en");
  const lines = [
    "# AnyTools",
    "",
    "> Free tools that run in the browser without an account, and AnyLearn, a study app that works from the documents you upload, on the AI account you already have. Available in English, Vietnamese, Spanish and Portuguese at /en, /vi, /es and /pt.",
    "",
    "AnyLearn answers questions with the page of your document it came from, writes practice questions and mock exams from your material, schedules spaced repetition, and keeps a 90-day learning loop. Most tools process files and text locally in the browser, so nothing is uploaded; each tool page says where its work happens.",
    "",
    "## AnyLearn",
    "",
    `- [AnyLearn](${APP_URL}/en/anylearn): study from your own documents, on your own AI`,
    "",
    "## Guides",
    "",
    ...listGuides("en").map((g) => `- [${g.title}](${APP_URL}/en/guides/${g.slug}): ${g.description}`),
  ];
  for (const cluster of POPULATED_CLUSTERS) {
    const tools = toolMetas.filter((m) => m.cluster === cluster && isIndexableTool(m, "en"));
    if (tools.length === 0) continue;
    lines.push("", `## ${t(`catalog.cluster.${cluster}`)}`, "");
    for (const m of tools) lines.push(`- [${toolTitle(m, "en")}](${APP_URL}/en/${m.cluster}/${m.slug}): ${toolDescription(m, "en")}`);
  }
  lines.push("", "## Optional", "", `- [All tools](${APP_URL}/en/tools)`, `- [About](${APP_URL}/en/about)`, `- [Sitemap](${APP_URL}/sitemap.xml)`, "");
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
