'use client';
import { Input, SegmentedControl, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { type Harmony, generatePalette } from './logic';
import { STRINGS } from './strings';

export function ColorPaletteUi() {
  const s = useLocalized(STRINGS);
  const [seed, setSeed] = useState('#2563EB');
  const [harmony, setHarmony] = useState<Harmony>('analogous');
  const palette = generatePalette(seed, harmony);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <span className="block text-sm font-medium mb-1.5">{s.seedColor}</span>
          <div className="flex gap-2">
            <input
              type="color"
              value={seed}
              onChange={(e) => setSeed(e.target.value.toUpperCase())}
              className="h-11 w-14 rounded border bg-card cursor-pointer"
              aria-label={s.seedColor}
            />
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="h-11 font-mono"
              aria-label={s.seedHex}
            />
          </div>
        </div>
        <SegmentedControl
          value={harmony}
          onChange={setHarmony}
          options={[
            { value: 'analogous', label: s.analogous },
            { value: 'complementary', label: s.complementary },
            { value: 'triadic', label: s.triadic },
            { value: 'tetradic', label: s.tetradic },
            { value: 'monochromatic', label: s.monochromatic },
          ]}
          label={s.harmony}
        />
      </div>
      <div className={`grid grid-cols-${Math.min(palette.length, 5)} gap-3`}>
        {palette.map((c) => (
          <div key={c} className="rounded-lg border overflow-hidden" style={{ backgroundColor: c }}>
            <div className="h-32" />
            <div className="bg-card border-t p-2 text-center">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(c)}
                className="text-xs font-mono hover:text-accent transition-colors"
                aria-label={s.copyColor.replace('{color}', c)}
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
