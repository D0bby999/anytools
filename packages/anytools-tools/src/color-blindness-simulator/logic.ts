/**
 * Color vision deficiency simulation via LMS (long/medium/short cone response) projection.
 *
 * Pipeline: sRGB -> linear RGB -> CIE XYZ -> LMS -> project out the missing cone response ->
 * XYZ -> linear RGB -> sRGB. The dichromat projections collapse one LMS axis onto the other
 * two along the "confusion line" a real dichromat cannot distinguish, which is the approach
 * from Brettel, Viénot & Mollon, "Computerized simulation of color appearance for dichromats",
 * J. Opt. Soc. Am. A 14(10), 1997, simplified to one matrix multiplication per type in Viénot,
 * Brettel & Mollon, "Digital video colourmaps for checking the legibility of displays by
 * dichromats", Color Research & Application 24(4), 1999.
 *
 * All numeric matrices below (sRGB<->XYZ, the Hunt-Pointer-Estevez XYZ<->LMS basis, and the
 * three dichromat projections) are taken from the worked derivation published by Martin
 * Krzywinski, BC Genome Sciences Centre: https://mk.bcgsc.ca/colorblind/math.mhtml — the sRGB
 * D65 matrices there match the standard reference values (e.g. Lindbloom's sRGB tables), which
 * is the cross-check that these were transcribed correctly rather than invented.
 *
 * Achromatopsia (total color blindness, no functioning cones at all) is not a dichromat case —
 * it collapses to pure luminance, so it uses the ITU-R BT.709 luma weights directly instead of
 * the LMS round trip, same as the same reference page and as browsers' own grayscale filters.
 *
 * Known simplification, disclosed rather than hidden: some LMS colors project outside the sRGB
 * gamut (most visibly on saturated reds/greens), which this clamps to [0,255] like most browser
 * simulators do, rather than doing Viénot et al.'s whole-image gamut compression step, which
 * needs a full image's color range, not just one pixel.
 */

export type Rgb = { r: number; g: number; b: number };
export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

export const CVD_TYPES: CvdType[] = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const clamped = Math.min(1, Math.max(0, v));
  const c = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

const XYZ_FROM_LINEAR_RGB: Mat3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const LINEAR_RGB_FROM_XYZ: Mat3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
const LMS_FROM_XYZ: Mat3 = [
  [0.4002, 0.7076, -0.0808],
  [-0.2263, 1.1653, 0.0457],
  [0, 0, 0.9182],
];
const XYZ_FROM_LMS: Mat3 = [
  [1.8600666, -1.1294801, 0.2198983],
  [0.3612229, 0.6388043, 0],
  [0, 0, 1.089087],
];

/** Brettel/Viénot dichromat confusion-line projections, in the LMS basis above. */
const DICHROMAT_PROJECTION: Record<Exclude<CvdType, 'achromatopsia'>, Mat3> = {
  protanopia: [
    [0, 1.05118294, -0.05116099],
    [0, 1, 0],
    [0, 0, 1],
  ],
  deuteranopia: [
    [1, 0, 0],
    [0.9513092, 0, 0.04866992],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.86744736, 1.86727089, 0],
  ],
};

function multiply3x3(a: Mat3, b: Mat3): Mat3 {
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
      const row = out[i];
      if (row) row[j] = sum;
    }
  }
  return out as Mat3;
}

function apply3x3(m: Mat3, v: [number, number, number]): [number, number, number] {
  const [r0, r1, r2] = m;
  const [x, y, z] = v;
  return [
    (r0?.[0] ?? 0) * x + (r0?.[1] ?? 0) * y + (r0?.[2] ?? 0) * z,
    (r1?.[0] ?? 0) * x + (r1?.[1] ?? 0) * y + (r1?.[2] ?? 0) * z,
    (r2?.[0] ?? 0) * x + (r2?.[1] ?? 0) * y + (r2?.[2] ?? 0) * z,
  ];
}

/**
 * The five chained matrices (XYZ->LMS->project->LMS->XYZ, sandwiched between the sRGB<->XYZ
 * conversion) are composed once into a single 3x3 per dichromat type, since matrix
 * multiplication is associative. That turns the per-pixel cost from five 3x3 multiplies down
 * to one, which matters once this runs over every pixel of an uploaded photo.
 */
function combinedMatrix(projection: Mat3): Mat3 {
  return multiply3x3(
    LINEAR_RGB_FROM_XYZ,
    multiply3x3(
      XYZ_FROM_LMS,
      multiply3x3(projection, multiply3x3(LMS_FROM_XYZ, XYZ_FROM_LINEAR_RGB)),
    ),
  );
}

const COMBINED: Record<Exclude<CvdType, 'achromatopsia'>, Mat3> = {
  protanopia: combinedMatrix(DICHROMAT_PROJECTION.protanopia),
  deuteranopia: combinedMatrix(DICHROMAT_PROJECTION.deuteranopia),
  tritanopia: combinedMatrix(DICHROMAT_PROJECTION.tritanopia),
};

/** ITU-R BT.709 luma weights — same coefficients CSS's own grayscale math is built on. */
function achromatopsiaOf({ r, g, b }: Rgb): Rgb {
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return { r: y, g: y, b: y };
}

/** Simulate how `rgb` would appear to someone with `type`. `type: null` returns it unchanged. */
export function simulate(rgb: Rgb, type: CvdType | null): Rgb {
  if (type === null) return rgb;
  if (type === 'achromatopsia') return achromatopsiaOf(rgb);
  const linear: [number, number, number] = [
    srgbToLinear(rgb.r),
    srgbToLinear(rgb.g),
    srgbToLinear(rgb.b),
  ];
  const [r, g, b] = apply3x3(COMBINED[type], linear);
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

/** In-place simulation over a canvas ImageData buffer (RGBA, 4 bytes per pixel). */
export function simulateImageData(data: Uint8ClampedArray, type: CvdType | null): void {
  if (type === null) return;
  for (let i = 0; i < data.length; i += 4) {
    const { r, g, b } = simulate(
      { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 },
      type,
    );
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const raw = m[1];
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const num = Number.parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
