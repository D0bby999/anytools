/**
 * WCAG 2.x contrast math — relative luminance + contrast ratio per
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance (formulas are spec facts).
 */

export type Rgb = { r: number; g: number; b: number };

export type ContrastRating = {
  ratio: number;
  aaNormal: boolean; // >= 4.5
  aaLarge: boolean; // >= 3
  aaaNormal: boolean; // >= 7
  aaaLarge: boolean; // >= 4.5
};

/** Parse #rgb or #rrggbb (leading # optional). Returns null on invalid input. */
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('').map((c) => Number.parseInt(c + c, 16));
    return { r: r as number, g: g as number, b: b as number };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function rateContrast(ratio: number): ContrastRating {
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

/**
 * Nudge the foreground toward black or white (whichever direction helps)
 * until the target ratio is met. Returns null if even pure black/white on
 * this background cannot reach the target.
 */
export function suggestForeground(fg: Rgb, bg: Rgb, target = 4.5): Rgb | null {
  if (contrastRatio(fg, bg) >= target) return fg;
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const towardBlack = contrastRatio(black, bg);
  const towardWhite = contrastRatio(white, bg);
  const end = towardBlack >= towardWhite ? black : white;
  if (Math.max(towardBlack, towardWhite) < target) return null;

  // Binary-search the blend factor between the original color and the endpoint —
  // keeps as much of the original hue as possible while reaching the target.
  const blend = (t: number): Rgb => ({
    r: fg.r + (end.r - fg.r) * t,
    g: fg.g + (end.g - fg.g) * t,
    b: fg.b + (end.b - fg.b) * t,
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(blend(mid), bg) >= target) hi = mid;
    else lo = mid;
  }
  const result = blend(hi);
  // Rounding to 8-bit can drop the ratio just under target — verify, else step further.
  return contrastRatio(parseHex(toHex(result)) as Rgb, bg) >= target
    ? parseHex(toHex(result))
    : end;
}
