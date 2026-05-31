'use client';
import { CalculatorTemplate, Input, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { contrastRatio, hexToRgb, rgbToHsl } from './logic';

export function ColorConverterUi() {
  const [fg, setFg] = useState('#1E293B');
  const [bg, setBg] = useState('#F8FAFC');

  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  const ratio = fgRgb && bgRgb ? contrastRatio(fgRgb, bgRgb) : 0;
  const fgHsl = fgRgb ? rgbToHsl(fgRgb) : null;
  const bgHsl = bgRgb ? rgbToHsl(bgRgb) : null;

  const passes = (threshold: number) => (ratio >= threshold ? 'Pass' : 'Fail');

  return (
    <CalculatorTemplate
      title="Color Converter + Contrast Checker"
      description="HEX ↔ RGB ↔ HSL plus WCAG 2.1 AA/AAA contrast ratio."
      inputs={
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1.5">Foreground (text)</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={fg}
                onChange={(e) => setFg(e.target.value.toUpperCase())}
                className="h-11 w-14 rounded border bg-card cursor-pointer"
                aria-label="Foreground color"
              />
              <Input
                value={fg}
                onChange={(e) => setFg(e.target.value)}
                className="h-11 font-mono tabular-nums"
                aria-label="Foreground hex"
              />
            </div>
            {fgRgb && fgHsl && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                rgb({fgRgb.r}, {fgRgb.g}, {fgRgb.b}) · hsl({fgHsl.h}, {fgHsl.s}%, {fgHsl.l}%)
              </p>
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Background</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={bg}
                onChange={(e) => setBg(e.target.value.toUpperCase())}
                className="h-11 w-14 rounded border bg-card cursor-pointer"
                aria-label="Background color"
              />
              <Input
                value={bg}
                onChange={(e) => setBg(e.target.value)}
                className="h-11 font-mono tabular-nums"
                aria-label="Background hex"
              />
            </div>
            {bgRgb && bgHsl && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                rgb({bgRgb.r}, {bgRgb.g}, {bgRgb.b}) · hsl({bgHsl.h}, {bgHsl.s}%, {bgHsl.l}%)
              </p>
            )}
          </div>
          <div
            className="rounded-md border p-4"
            style={{ backgroundColor: bg, color: fg }}
            aria-label="Live preview"
          >
            <p className="text-lg font-semibold">The quick brown fox</p>
            <p className="text-sm">jumps over the lazy dog.</p>
          </div>
        </div>
      }
      result={
        <TableResult
          title="WCAG 2.1 Contrast"
          rows={[
            {
              label: 'Contrast ratio',
              value: `${ratio.toFixed(2)}:1`,
              emphasis: true,
            },
            { label: 'AA normal text (4.5:1)', value: passes(4.5) },
            { label: 'AA large text (3:1)', value: passes(3) },
            { label: 'AAA normal text (7:1)', value: passes(7) },
            { label: 'AAA large text (4.5:1)', value: passes(4.5) },
          ]}
        />
      }
      onReset={() => {
        setFg('#1E293B');
        setBg('#F8FAFC');
      }}
    />
  );
}
