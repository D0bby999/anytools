/**
 * tools/og-image.server.ts
 * The 1200x630 card a link to a tool page unfurls into: the tool's name, its
 * one-line description and its cluster, in the world of deploy/og/og.html.
 *
 * Satori lays the card out as SVG with the text already turned into paths,
 * and resvg (wasm, no native binary) rasterises it. Both are server-only, so
 * no page's bundle grows. The fonts are the app's own Literata and Be Vietnam Pro cuts from
 * @fontsource, in .woff (satori cannot read woff2), latin and Vietnamese
 * subsets both, so a Vietnamese title draws its own glyphs.
 *
 * Colours are read from tokens.css (the light theme), so the card cannot drift
 * from the app and no colour is restated here.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import tokensCss from "~/tokens.css?raw";

const require = createRequire(import.meta.url);

function token(name: string): string {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? "";
  const value = new RegExp(`--lp-${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
  if (!value) throw new Error(`tokens.css has no --lp-${name}`);
  return value;
}

type Font = { name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" };

function fonts(): Font[] {
  const file = (pkg: string, base: string, subset: string, weight: number) =>
    readFileSync(require.resolve(`@fontsource/${pkg}/files/${base}-${subset}-${weight}-normal.woff`));
  const out: Font[] = [];
  for (const subset of ["latin", "latin-ext", "vietnamese"]) {
    out.push({ name: "Serif", data: file("literata", "literata", subset, 600), weight: 600, style: "normal" });
    out.push({ name: "Sans", data: file("be-vietnam-pro", "be-vietnam-pro", subset, 400), weight: 400, style: "normal" });
    out.push({ name: "Sans", data: file("be-vietnam-pro", "be-vietnam-pro", subset, 600), weight: 600, style: "normal" });
  }
  return out;
}

let ready: Promise<Font[]> | null = null;

function setup(): Promise<Font[]> {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    return fonts();
  })();
  return ready;
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: Node | Node[] | string } };
const el = (type: string, style: Record<string, unknown>, children?: Node | Node[] | string): Node => ({
  type,
  props: { style, children },
});

/** A tool's card, as PNG bytes. */
export async function renderToolCard(input: { title: string; description: string; cluster: string }): Promise<Uint8Array> {
  const loaded = await setup();
  const ink = token("ink");
  // A page of the book's tools appendix: the slate part tab, the title in the
  // book face, the description, and a running foot.
  const card = el(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "72px 96px",
      background: token("paper"),
      color: ink,
    },
    [
      el("div", { display: "flex", alignItems: "center", gap: 20 }, [
        el("div", { fontFamily: "Serif", fontSize: 40, fontWeight: 600 }, "AnyTools"),
        el(
          "div",
          {
            fontFamily: "Sans",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: 2,
            textTransform: "uppercase",
            padding: "4px 14px",
            borderRadius: 8,
            background: token("part-tools"),
            color: token("part-tools-fg"),
          },
          input.cluster,
        ),
      ]),
      el("div", { display: "flex", flexDirection: "column", gap: 24 }, [
        el("div", { fontFamily: "Serif", fontSize: 64, fontWeight: 600, lineHeight: 1.12 }, input.title),
        el("div", { fontFamily: "Sans", fontSize: 28, color: token("ink-2"), lineHeight: 1.45 }, input.description),
      ]),
      el(
        "div",
        {
          display: "flex",
          justifyContent: "flex-end",
          borderTop: `1px solid ${token("border")}`,
          paddingTop: 24,
          fontFamily: "Sans",
          fontSize: 22,
          color: token("ink-2"),
        },
        [el("div", { color: token("brand"), fontWeight: 600 }, "anytools.world")],
      ),
    ],
  );
  const svg = await satori(card as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loaded });
  return new Resvg(svg).render().asPng();
}
