/**
 * theme-contrast.test.ts
 *
 * Contrast guard for the design tokens, ported from postclaw's
 * `ui/web/app/test/theme-contrast.test.ts` and extended to composite the
 * translucent `-soft` tints against the surface they are painted on.
 *
 * Why it exists: the tokens are plain hex in a CSS file. Nothing type-checks
 * them and no component test reads them, so a hue tweak that drops a label
 * under AA fails absolutely nothing today. postclaw measured this exact bug in
 * production: every accent-as-text pairing passed in dark and every one FAILED
 * in light, because the light palette reused saturated chart hues for text.
 *
 * It also pins the finding that produced the dark ramp in tokens.css: `up`
 * ships ONE brand green for both themes, and on a dark canvas that green
 * measures 2.82:1 as text. Light and dark are composed separately here, so
 * this file is what stops the next person from "simplifying" them back
 * together.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const css = readFileSync(join(resolve(process.cwd()), "app/tokens.css"), "utf8");

/** Pulls `--name: value` pairs out of one top-level selector block. */
function readBlock(selector: string): Record<string, string> {
  const re = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const body = re.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) out[name] = value.trim();
  }
  return out;
}

const light = readBlock(":root");
// Dark overrides light rather than replacing it: a token the dark block does
// not restate keeps its light value, which is exactly how the cascade behaves.
const dark = { ...light, ...readBlock(".dark") };

type Rgb = [number, number, number];

function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    const n = hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as Rgb,
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`not a colour this guard can measure: ${value}`);
}

/** Paints `value` over `backdrop`, so a translucent tint is measured as seen. */
function flatten(value: string, backdrop: Rgb): Rgb {
  const { rgb, alpha } = parseColor(value);
  return rgb.map((c, i) => Math.round(c * alpha + backdrop[i]! * (1 - alpha))) as Rgb;
}

function luminance(rgb: Rgb): number {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The three backdrops any text in this app can land on. */
const SURFACES = ["lp-paper", "lp-surface", "lp-surface-soft"] as const;

const THEMES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ["light", light],
  ["dark", dark],
];

describe("tokens parse", () => {
  it.each(THEMES)("%s block defines the whole colour vocabulary", (_mode, t) => {
    for (const name of [
      "lp-paper",
      "lp-surface",
      "lp-surface-soft",
      "lp-ink",
      "lp-ink-2",
      "lp-ink-3",
      "lp-brand",
      "lp-brand-soft",
      "lp-brand-fg",
      "lp-accent",
      "lp-warning",
      "lp-danger",
      "lp-border-control",
    ]) {
      expect(t[name], `--${name} missing`).toBeTruthy();
    }
  });
});

describe("ink is legible on every surface", () => {
  it.each(THEMES)("%s", (_mode, t) => {
    for (const ink of ["lp-ink", "lp-ink-2", "lp-ink-3"]) {
      for (const surface of SURFACES) {
        const bg = flatten(t[surface]!, [255, 255, 255]);
        const ratio = contrast(flatten(t[ink]!, bg), bg);
        expect(
          ratio,
          `--${ink} ${t[ink]} on --${surface} ${t[surface]} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe("the action ink is legible as text", () => {
  // Brand green is a link colour inside prose and the label of the current nav
  // row, not only a button fill, so it is held to text contrast.
  it.each(THEMES)("%s: brand on every surface", (_mode, t) => {
    for (const surface of SURFACES) {
      const bg = flatten(t[surface]!, [255, 255, 255]);
      const ratio = contrast(flatten(t["lp-brand"]!, bg), bg);
      expect(
        ratio,
        `--lp-brand ${t["lp-brand"]} on --${surface} ${t[surface]} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  // A hovered (not current) nav row paints ordinary ink on the translucent
  // brand tint. That pairing is invisible to a naive hex check because the tint
  // has to be composited against the rail first. Measured 2026-09-16: painting
  // --lp-brand itself here reached only 4.48:1, which is why the current row
  // uses the frozen --lp-selected pair instead of the live tint.
  it.each(THEMES)("%s: ink stays legible on a hovered row", (_mode, t) => {
    const rail = flatten(t["lp-surface-soft"]!, [255, 255, 255]);
    const tint = flatten(t["lp-brand-soft"]!, rail);
    for (const ink of ["lp-ink", "lp-ink-2"]) {
      const ratio = contrast(flatten(t[ink]!, tint), tint);
      expect(
        ratio,
        `--${ink} on --lp-brand-soft over the rail = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(THEMES)("%s: the hover and active steps stay legible on the page", (_mode, t) => {
    const page = flatten(t["lp-paper"]!, [255, 255, 255]);
    for (const step of ["lp-brand-hover", "lp-brand-active"]) {
      const ratio = contrast(flatten(t[step]!, page), page);
      expect(ratio, `--${step} on the page = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });
});

describe("text on a solid fill", () => {
  // Every `<role>-fg` token exists to be painted on `<role>`. Checking the pair
  // generically means a role added later is covered without editing this file.
  it.each(THEMES)("%s: -fg tokens are legible on their own fill", (_mode, t) => {
    const pairs = Object.keys(t).filter((k) => k.endsWith("-fg") && t[k.slice(0, -3)]);
    expect(pairs.length, "no -fg pairs found").toBeGreaterThan(0);

    for (const fg of pairs) {
      const base = fg.slice(0, -3);
      const fill = flatten(t[base]!, [255, 255, 255]);
      const ratio = contrast(flatten(t[fg]!, fill), fill);
      expect(ratio, `--${fg} on --${base} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("state inks are legible as text", () => {
  it.each(THEMES)("%s: warning and danger on every surface", (_mode, t) => {
    for (const ink of ["lp-warning", "lp-danger"]) {
      for (const surface of SURFACES) {
        const bg = flatten(t[surface]!, [255, 255, 255]);
        const ratio = contrast(flatten(t[ink]!, bg), bg);
        expect(
          ratio,
          `--${ink} ${t[ink]} on --${surface} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it.each(THEMES)("%s: state text stays legible on its own soft tint", (_mode, t) => {
    for (const ink of ["lp-warning", "lp-danger"]) {
      const surface = flatten(t["lp-surface"]!, [255, 255, 255]);
      const tint = flatten(t[`${ink}-soft`]!, surface);
      const ratio = contrast(flatten(t[ink]!, tint), tint);
      expect(ratio, `--${ink} on --${ink}-soft = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });
});

describe("things you can see but not read", () => {
  // WCAG 1.4.11: the outline that identifies an operable control, and the
  // progress hairline, are non-text contrast at 3:1. The decorative hairline
  // (`--lp-border`) is deliberately exempt and deliberately not used to
  // identify a control.
  it.each(THEMES)("%s: control outlines reach 3:1 on every surface", (_mode, t) => {
    for (const surface of SURFACES) {
      const bg = flatten(t[surface]!, [255, 255, 255]);
      const ratio = contrast(flatten(t["lp-border-control"]!, bg), bg);
      expect(
        ratio,
        `--lp-border-control on --${surface} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it.each(THEMES)("%s: the reading-progress hairline reads against the page", (_mode, t) => {
    const bg = flatten(t["lp-paper"]!, [255, 255, 255]);
    const ratio = contrast(flatten(t["lp-accent"]!, bg), bg);
    expect(ratio, `--lp-accent on --lp-paper = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });

  it.each(THEMES)("%s: the focus ring reads against every surface", (_mode, t) => {
    for (const surface of SURFACES) {
      const bg = flatten(t[surface]!, [255, 255, 255]);
      const ratio = contrast(flatten(t["lp-brand"]!, bg), bg);
      expect(ratio, `focus ring on --${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });
});

describe("the two accent inks stay distinguishable", () => {
  // Terracotta (reading progress) and the danger red are adjacent hues. They
  // never share an element, but if they drift together the "progress" hairline
  // and an error start reading as the same signal.
  it.each(THEMES)("%s", (_mode, t) => {
    const accent = parseColor(t["lp-accent"]!).rgb;
    const danger = parseColor(t["lp-danger"]!).rgb;
    const distance = Math.hypot(...accent.map((c, i) => c - danger[i]!));
    expect(
      distance,
      `--lp-accent ${t["lp-accent"]} and --lp-danger ${t["lp-danger"]} are ${distance.toFixed(0)} apart in RGB`,
    ).toBeGreaterThan(60);
  });
});
