import type { GradientState } from './logic';

/** Starting points, not a gallery: every one is editable once loaded. */
export const GRADIENT_PRESETS: { name: string; state: GradientState }[] = [
  {
    name: 'Sunset',
    state: {
      kind: 'linear',
      angle: 135,
      repeating: false,
      stops: [
        { color: '#FF512F', position: 0 },
        { color: '#F09819', position: 100 },
      ],
    },
  },
  {
    name: 'Ocean',
    state: {
      kind: 'linear',
      angle: 90,
      repeating: false,
      stops: [
        { color: '#2E3192', position: 0 },
        { color: '#1BFFFF', position: 100 },
      ],
    },
  },
  {
    name: 'Peach',
    state: {
      kind: 'linear',
      angle: 45,
      repeating: false,
      stops: [
        { color: '#FFE29F', position: 0 },
        { color: '#FFA99F', position: 48 },
        { color: '#FF719A', position: 100 },
      ],
    },
  },
  {
    name: 'Midnight',
    state: {
      kind: 'linear',
      angle: 180,
      repeating: false,
      stops: [
        { color: '#0F2027', position: 0 },
        { color: '#203A43', position: 50 },
        { color: '#2C5364', position: 100 },
      ],
    },
  },
  {
    name: 'Mint',
    state: {
      kind: 'linear',
      angle: 160,
      repeating: false,
      stops: [
        { color: '#43E97B', position: 0 },
        { color: '#38F9D7', position: 100 },
      ],
    },
  },
  {
    name: 'Spotlight',
    state: {
      kind: 'radial',
      shape: 'circle',
      size: 'farthest-corner',
      cx: 30,
      cy: 25,
      repeating: false,
      stops: [
        { color: '#FDFCFB', position: 0 },
        { color: '#7F7FD5', position: 100 },
      ],
    },
  },
  {
    name: 'Colour wheel',
    state: {
      kind: 'conic',
      angle: 0,
      cx: 50,
      cy: 50,
      repeating: false,
      stops: [
        { color: '#FF0000', position: 0 },
        { color: '#FFFF00', position: 17 },
        { color: '#00FF00', position: 33 },
        { color: '#00FFFF', position: 50 },
        { color: '#0000FF', position: 67 },
        { color: '#FF00FF', position: 83 },
        { color: '#FF0000', position: 100 },
      ],
    },
  },
  {
    name: 'Stripes',
    state: {
      kind: 'linear',
      angle: 45,
      repeating: true,
      stops: [
        { color: '#1F2937', position: 0 },
        { color: '#1F2937', position: 5 },
        { color: '#374151', position: 5 },
        { color: '#374151', position: 10 },
      ],
    },
  },
];
