'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  RangeSlider,
  SegmentedControl,
} from '@anytools/ui';
import { useState } from 'react';
import { hexToRgb, rgbToHex } from '../color-converter/logic';
import {
  type ColorStop,
  type GradientKind,
  type GradientState,
  type RadialSize,
  parse,
  toCss,
  toCssBlock,
  toTailwind,
  withKind,
} from './logic';
import { GRADIENT_PRESETS } from './presets';

const SLUG = 'css-gradient-generator';
const SIZES: RadialSize[] = ['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'];

/**
 * Reuses color-converter's hex parser so `#abc` and `#AABBCC` both drive the native
 * swatch. Non-hex colours (named, rgb(), hsl()) keep working in the text field — the
 * swatch just falls back to black, since <input type="color"> only speaks #rrggbb.
 */
function swatchHex(color: string): string {
  const rgb = hexToRgb(color.trim());
  return rgb ? rgbToHex(rgb).toLowerCase() : '#000000';
}

export function CssGradientGeneratorUi() {
  const [g, setG] = useState<GradientState>(() => GRADIENT_PRESETS[0]?.state as GradientState);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState(false);

  const css = toCss(g);
  const setStops = (stops: ColorStop[]) => setG((prev) => ({ ...prev, stops }));
  const updateStop = (i: number, patch: Partial<ColorStop>) =>
    setStops(g.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const setAngle = (angle: number) => setG((prev) => ('angle' in prev ? { ...prev, angle } : prev));
  const setCentre = (c: { cx?: number; cy?: number }) =>
    setG((prev) => ('cx' in prev ? { ...prev, ...c } : prev));

  const loadCss = () => {
    const parsed = parse(importText);
    setImportError(parsed === null);
    if (parsed) {
      setG(parsed);
      trackEvent('tool_run', { tool: SLUG });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">CSS Gradient Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="h-48 rounded-lg border"
          style={{ background: css }}
          data-testid="gradient-preview"
          aria-label="Gradient preview"
        />

        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl
            className="flex-1 min-w-[15rem]"
            label="Type"
            value={g.kind}
            onChange={(kind: GradientKind) => setG(withKind(g, kind))}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'radial', label: 'Radial' },
              { value: 'conic', label: 'Conic' },
            ]}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={g.repeating}
              onChange={(e) => setG({ ...g, repeating: e.target.checked })}
            />
            Repeating
          </label>
        </div>

        {'angle' in g && (
          <RangeSlider
            label={g.kind === 'conic' ? 'Start angle' : 'Angle'}
            unit="deg"
            min={-180}
            max={360}
            value={g.angle}
            onChange={setAngle}
          />
        )}
        {g.kind === 'radial' && (
          <div className="flex flex-wrap gap-3">
            <SegmentedControl
              className="flex-1 min-w-[12rem]"
              label="Shape"
              value={g.shape}
              onChange={(shape: 'circle' | 'ellipse') => setG({ ...g, shape })}
              options={[
                { value: 'circle', label: 'Circle' },
                { value: 'ellipse', label: 'Ellipse' },
              ]}
            />
            <div className="flex-1 min-w-[12rem]">
              <span className="block text-sm font-medium mb-1.5">Size</span>
              <select
                aria-label="Radial size"
                value={g.size}
                onChange={(e) => setG({ ...g, size: e.target.value as RadialSize })}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {'cx' in g && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RangeSlider
              label="Centre X"
              unit="%"
              min={0}
              max={100}
              value={g.cx}
              onChange={(cx) => setCentre({ cx })}
            />
            <RangeSlider
              label="Centre Y"
              unit="%"
              min={0}
              max={100}
              value={g.cy}
              onChange={(cy) => setCentre({ cy })}
            />
          </div>
        )}

        <div className="space-y-2">
          <span className="block text-sm font-medium">Colour stops</span>
          {g.stops.map((stop, i) => (
            <div key={`stop-${i}-${stop.color}`} className="flex items-center gap-2">
              <input
                type="color"
                value={swatchHex(stop.color)}
                onChange={(e) => updateStop(i, { color: e.target.value.toUpperCase() })}
                aria-label={`Stop ${i + 1} colour picker`}
                className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
              <Input
                value={stop.color}
                onChange={(e) => updateStop(i, { color: e.target.value })}
                aria-label={`Stop ${i + 1} colour`}
                className="h-11 font-mono"
              />
              <Input
                type="number"
                value={stop.position ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  updateStop(i, {
                    position: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                aria-label={`Stop ${i + 1} position in percent`}
                className="h-11 w-24 shrink-0 font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                disabled={g.stops.length <= 2}
                aria-label={`Remove stop ${i + 1}`}
                onClick={() => setStops(g.stops.filter((_, idx) => idx !== i))}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStops([...g.stops, { color: '#FFFFFF', position: 100 }])}
          >
            Add stop
          </Button>
        </div>

        <div>
          <span className="block text-sm font-medium mb-1.5">Presets</span>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {GRADIENT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                title={p.name}
                aria-label={p.name}
                onClick={() => setG(p.state)}
                className="h-11 rounded-md border transition-transform hover:scale-105"
                style={{ background: toCss(p.state) }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">CSS</span>
            <CopyButton
              text={toCssBlock(g)}
              onCopied={() => trackEvent('tool_run', { tool: SLUG })}
            />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toCssBlock(g)}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Tailwind</span>
            <CopyButton
              text={toTailwind(g)}
              onCopied={() => trackEvent('tool_run', { tool: SLUG })}
            />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toTailwind(g)}
          </pre>
        </div>

        <div>
          <span className="block text-sm font-medium mb-1.5">Edit an existing gradient</span>
          <div className="flex gap-2">
            <Input
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="background: linear-gradient(90deg, #fff 0%, #000 100%);"
              aria-label="Paste CSS to load"
              aria-invalid={importError}
              className="h-11 font-mono"
            />
            <Button className="h-11 shrink-0" onClick={loadCss}>
              Load CSS
            </Button>
          </div>
          {importError && (
            <p className="mt-1.5 text-sm text-destructive">
              Not a gradient this editor can represent — stop positions must be percentages, and
              explicit radii or interpolation hints are not supported.
            </p>
          )}
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
