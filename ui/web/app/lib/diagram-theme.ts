/**
 * diagram-theme.ts
 * DESIGN.md's colour tokens, read from the live page for things that cannot
 * inherit page CSS: a Mermaid SVG shown through `<img>`, and a Chart.js
 * canvas. Read at draw time, so the current theme (light or dark) applies.
 * No colour is written here; every value is the token's computed one.
 */

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type DiagramTheme = {
  ink: string;
  muted: string;
  paper: string;
  surface: string;
  border: string;
  brand: string;
  brandSoft: string;
  fontSans: string;
  /** Series colours for charts, in order. */
  series: string[];
};

export function readDiagramTheme(): DiagramTheme {
  return {
    ink: token("--lp-ink"),
    muted: token("--lp-ink-2"),
    paper: token("--lp-paper"),
    surface: token("--lp-surface"),
    border: token("--lp-border"),
    brand: token("--lp-brand"),
    brandSoft: token("--lp-brand-soft"),
    fontSans: token("--lp-font-sans"),
    series: ["--lp-brand", "--lp-accent", "--lp-warning", "--lp-danger", "--lp-ink-2", "--lp-ink-3"]
      .map(token)
      .filter(Boolean),
  };
}
