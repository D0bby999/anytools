// @vitest-environment node
/**
 * tools-server-render.test.tsx
 * AnyTools phase 3c: the public tool page renders its tool on the server
 * (components/tools-site/tool-frame.tsx), where the old site rendered every
 * tool in the browser only. A tool that touches `window`, `document` or a
 * browser-only library while rendering throws there, and React then sends the
 * loading line instead of the tool. This renders every ported tool the way
 * the server does, with no DOM at all, and asks for the tool's own markup.
 */
import { describe, expect, it } from "vitest";
import { prerenderToNodeStream } from "react-dom/static";
import { I18nextProvider } from "react-i18next";
import { ToolFrame } from "~/components/tools-site/tool-frame";
import { toolsI18n } from "~/lib/tools/i18n";
import { TOOL_UIS } from "~/tools/ui-registry";

const ported = Object.keys(TOOL_UIS).sort();

async function serverHtml(slug: string): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(
    <I18nextProvider i18n={toolsI18n("en", null)}>
      <ToolFrame slug={slug} locale="en" />
    </I18nextProvider>,
    { onError: (e) => void errors.push(e) },
  );
  let html = "";
  for await (const chunk of prelude) html += String(chunk);
  return { html, errors };
}

describe("on the server, with no DOM", () => {
  it("there is no DOM here", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it.each(ported)("%s renders its own markup", async (slug) => {
    const { html, errors } = await serverHtml(slug);
    expect(errors.map(String)).toEqual([]);
    expect(html).not.toContain(toolsI18n("en", null).t("tools:tool.loading"));
    expect(html).toMatch(/<(input|textarea|button|select)\b/);
  }, 30_000);
});
