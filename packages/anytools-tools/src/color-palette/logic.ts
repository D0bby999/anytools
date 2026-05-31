export type Harmony = 'analogous' | 'complementary' | 'triadic' | 'tetradic' | 'monochromatic';

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m || !m[1]) return null;
  const n = Number.parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  // Normalize hue to [0, 360) before any computation to handle negative or >360 values
  const hn = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ll - c / 2;
  const region = Math.floor(hn / 60);
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][region] ?? [0, 0, 0];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb[0] ?? 0)}${toHex(rgb[1] ?? 0)}${toHex(rgb[2] ?? 0)}`.toUpperCase();
}

export function generatePalette(seedHex: string, harmony: Harmony): string[] {
  const hsl = hexToHsl(seedHex);
  if (!hsl) return [seedHex];
  const { h, s, l } = hsl;
  switch (harmony) {
    case 'analogous':
      return [-30, -15, 0, 15, 30].map((off) => hslToHex(h + off, s, l));
    case 'complementary':
      return [hslToHex(h, s, l), hslToHex(h + 180, s, l)];
    case 'triadic':
      return [0, 120, 240].map((off) => hslToHex(h + off, s, l));
    case 'tetradic':
      return [0, 90, 180, 270].map((off) => hslToHex(h + off, s, l));
    case 'monochromatic':
      return [20, 35, 50, 65, 80].map((lv) => hslToHex(h, s, lv));
  }
}
