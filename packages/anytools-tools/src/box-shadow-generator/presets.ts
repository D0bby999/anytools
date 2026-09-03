import type { ShadowLayer } from './logic';

const layer = (y: number, blur: number, spread: number, alpha: number, x = 0): ShadowLayer => ({
  x,
  y,
  blur,
  spread,
  color: `rgba(0, 0, 0, ${alpha})`,
  inset: false,
});

/**
 * Two families, both editable after loading.
 *
 * "Material N" follows the elevation model described at
 * https://m2.material.io/design/environment/elevation.html — three stacked layers
 * (a tight key-light umbra, a wider penumbra, a soft ambient layer), which is why they
 * read as a light source rather than as a grey blur.
 *
 * "Tailwind …" are the scale values published at
 * https://tailwindcss.com/docs/box-shadow — useful when you need one step off the
 * scale a project already uses.
 */
export const SHADOW_PRESETS: { name: string; layers: ShadowLayer[] }[] = [
  {
    name: 'Material 1',
    layers: [layer(2, 1, -1, 0.2), layer(1, 1, 0, 0.14), layer(1, 3, 0, 0.12)],
  },
  {
    name: 'Material 2',
    layers: [layer(3, 1, -2, 0.2), layer(2, 2, 0, 0.14), layer(1, 5, 0, 0.12)],
  },
  {
    name: 'Material 3',
    layers: [layer(3, 3, -2, 0.2), layer(3, 4, 0, 0.14), layer(1, 8, 0, 0.12)],
  },
  {
    name: 'Material 4',
    layers: [layer(2, 4, -1, 0.2), layer(4, 5, 0, 0.14), layer(1, 10, 0, 0.12)],
  },
  {
    name: 'Material 5',
    layers: [layer(3, 5, -1, 0.2), layer(5, 8, 0, 0.14), layer(1, 14, 0, 0.12)],
  },
  { name: 'Tailwind sm', layers: [layer(1, 2, 0, 0.05)] },
  { name: 'Tailwind base', layers: [layer(1, 3, 0, 0.1), layer(1, 2, -1, 0.1)] },
  { name: 'Tailwind md', layers: [layer(4, 6, -1, 0.1), layer(2, 4, -2, 0.1)] },
  { name: 'Tailwind lg', layers: [layer(10, 15, -3, 0.1), layer(4, 6, -4, 0.1)] },
  { name: 'Tailwind xl', layers: [layer(20, 25, -5, 0.1), layer(8, 10, -6, 0.1)] },
  { name: 'Tailwind 2xl', layers: [layer(25, 50, -12, 0.25)] },
  { name: 'Inner', layers: [{ ...layer(2, 4, 0, 0.06), inset: true }] },
];
