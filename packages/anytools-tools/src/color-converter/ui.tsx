'use client';
import { CalculatorTemplate, Input, TableResult, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { contrastRatio, hexToRgb, rgbToHsl } from './logic';
import { STRINGS } from './strings';

export function ColorConverterUi() {
  const s = useLocalized(STRINGS);
  const [fg, setFg] = useState('#1E293B');
  const [bg, setBg] = useState('#F8FAFC');

  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  const ratio = fgRgb && bgRgb ? contrastRatio(fgRgb, bgRgb) : 0;
  const fgHsl = fgRgb ? rgbToHsl(fgRgb) : null;
  const bgHsl = bgRgb ? rgbToHsl(bgRgb) : null;

  const passes = (threshold: number) => (ratio >= threshold ? s.pass : s.fail);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.foreground}</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={fg}
                onChange={(e) => setFg(e.target.value.toUpperCase())}
                className="h-11 w-14 rounded border bg-card cursor-pointer"
                aria-label={s.foregroundColor}
              />
              <Input
                value={fg}
                onChange={(e) => setFg(e.target.value)}
                className="h-11 font-mono tabular-nums"
                aria-label={s.foregroundHex}
              />
            </div>
            {fgRgb && fgHsl && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                rgb({fgRgb.r}, {fgRgb.g}, {fgRgb.b}) · hsl({fgHsl.h}, {fgHsl.s}%, {fgHsl.l}%)
              </p>
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.background}</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={bg}
                onChange={(e) => setBg(e.target.value.toUpperCase())}
                className="h-11 w-14 rounded border bg-card cursor-pointer"
                aria-label={s.backgroundColor}
              />
              <Input
                value={bg}
                onChange={(e) => setBg(e.target.value)}
                className="h-11 font-mono tabular-nums"
                aria-label={s.backgroundHex}
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
            aria-label={s.livePreview}
          >
            <p className="text-lg font-semibold">{s.sampleLine1}</p>
            <p className="text-sm">{s.sampleLine2}</p>
          </div>
        </div>
      }
      result={
        <TableResult
          title={s.wcagTitle}
          rows={[
            {
              label: s.contrastRatio,
              value: `${ratio.toFixed(2)}:1`,
              emphasis: true,
            },
            { label: s.aaNormal, value: passes(4.5) },
            { label: s.aaLarge, value: passes(3) },
            { label: s.aaaNormal, value: passes(7) },
            { label: s.aaaLarge, value: passes(4.5) },
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
