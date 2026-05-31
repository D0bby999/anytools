'use client';
import { Input, SegmentedControl } from '@anytools/ui';
import { useState } from 'react';
import { type Harmony, generatePalette } from './logic';

export function ColorPaletteUi() {
  const [seed, setSeed] = useState('#2563EB');
  const [harmony, setHarmony] = useState<Harmony>('analogous');
  const palette = generatePalette(seed, harmony);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Color Palette Generator</h2>
        <p className="text-sm text-muted-foreground">Harmonized palettes from a seed color.</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <span className="block text-sm font-medium mb-1.5">Seed color</span>
          <div className="flex gap-2">
            <input
              type="color"
              value={seed}
              onChange={(e) => setSeed(e.target.value.toUpperCase())}
              className="h-11 w-14 rounded border bg-card cursor-pointer"
              aria-label="Seed color"
            />
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="h-11 font-mono"
              aria-label="Seed hex"
            />
          </div>
        </div>
        <SegmentedControl
          value={harmony}
          onChange={setHarmony}
          options={[
            { value: 'analogous', label: 'Analogous' },
            { value: 'complementary', label: 'Complement' },
            { value: 'triadic', label: 'Triadic' },
            { value: 'tetradic', label: 'Tetradic' },
            { value: 'monochromatic', label: 'Mono' },
          ]}
          label="Harmony"
        />
      </div>
      <div className={`grid grid-cols-${Math.min(palette.length, 5)} gap-3`}>
        {palette.map((c) => (
          <div
            key={c}
            className="rounded-lg border overflow-hidden"
            style={{ backgroundColor: c }}
          >
            <div className="h-32" />
            <div className="bg-card border-t p-2 text-center">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(c)}
                className="text-xs font-mono hover:text-accent transition-colors"
                aria-label={`Copy ${c}`}
              >
                {c}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
