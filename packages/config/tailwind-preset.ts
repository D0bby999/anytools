import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind preset for all AnyTools packages.
 * Apps and packages extend this via `presets: [tailwindPreset]`.
 */
const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
};

export default preset;
