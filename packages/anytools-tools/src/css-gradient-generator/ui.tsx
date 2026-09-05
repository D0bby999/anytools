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
  useLocalized,
} from '@anytools/ui';
import { useRef, useState } from 'react';
import { hexToRgb, rgbToHex } from '../color-converter/logic';
import {
  type ColorStop,
  type GradientKind,
  type GradientState,
  type RadialSize,
  toCss,
  toCssBlock,
  toTailwind,
} from './logic';
import { type ParseFailure, parseGradient } from './parse';
import { GRADIENT_PRESETS } from './presets';
import {
  type GradientEditorState,
  appendRow,
  removeRow,
  switchKind,
  updateRow,
  withRowIds,
} from './stop-rows';
import { StopTrack } from './stop-track';
import { STRINGS } from './strings';

/** The rejection in the page's language when the strings table knows its code, else as written. */
function parseFailureText(failure: ParseFailure, s: Record<string, string>): string {
  const template = s[`error_${failure.code}`];
  if (!template) return failure.reason;
  const params = failure.params ?? {};
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m,
  );
}

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
  const s = useLocalized(STRINGS);
  const [g, setG] = useState<GradientEditorState>(() =>
    withRowIds(GRADIENT_PRESETS[0]?.state as GradientState),
  );
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  // `tool_run` counts sessions that got something out of the tool, so it fires once per
  // mount: one visitor copying five variants is one run, and a visitor who copies
  // nothing is none.
  const counted = useRef(false);

  const css = toCss(g);
  // Preset names live in presets.ts in English; look them up by name here.
  const presetName = (name: string) =>
    (s as Record<string, string>)[`preset_${name.replace(/\s+/g, '')}`] ?? name;
  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };
  const setStops = (stops: GradientEditorState['stops']) => setG((prev) => ({ ...prev, stops }));
  const updateStop = (i: number, patch: Partial<ColorStop>) =>
    setStops(updateRow(g.stops, i, patch));
  const setAngle = (angle: number) => setG((prev) => ('angle' in prev ? { ...prev, angle } : prev));
  const setCentre = (c: { cx?: number; cy?: number }) =>
    setG((prev) => ('cx' in prev ? { ...prev, ...c } : prev));

  const loadCss = () => {
    const parsed = parseGradient(importText);
    if (parsed.ok) {
      setImportError(null);
      setG(withRowIds(parsed.state));
      countRun();
    } else {
      setImportError(parseFailureText(parsed, s));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="h-48 rounded-lg border"
          style={{ background: css }}
          data-testid="gradient-preview"
          aria-label={s.gradientPreview}
        />
        <StopTrack rows={g.stops} onMove={(i, position) => updateStop(i, { position })} />

        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl
            className="flex-1 min-w-[15rem]"
            label={s.type}
            value={g.kind}
            onChange={(kind: GradientKind) => setG(switchKind(g, kind))}
            options={[
              { value: 'linear', label: s.linear },
              { value: 'radial', label: s.radial },
              { value: 'conic', label: s.conic },
            ]}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={g.repeating}
              onChange={(e) => setG({ ...g, repeating: e.target.checked })}
            />
            {s.repeating}
          </label>
        </div>

        {'angle' in g && (
          <RangeSlider
            label={g.kind === 'conic' ? s.startAngle : s.angle}
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
              label={s.shape}
              value={g.shape}
              onChange={(shape: 'circle' | 'ellipse') => setG({ ...g, shape })}
              options={[
                { value: 'circle', label: s.circle },
                { value: 'ellipse', label: s.ellipse },
              ]}
            />
            <div className="flex-1 min-w-[12rem]">
              <span className="block text-sm font-medium mb-1.5">{s.size}</span>
              <select
                aria-label={s.radialSize}
                value={g.size}
                onChange={(e) => setG({ ...g, size: e.target.value as RadialSize })}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {'cx' in g && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RangeSlider
              label={s.centreX}
              unit="%"
              min={0}
              max={100}
              value={g.cx}
              onChange={(cx) => setCentre({ cx })}
            />
            <RangeSlider
              label={s.centreY}
              unit="%"
              min={0}
              max={100}
              value={g.cy}
              onChange={(cy) => setCentre({ cy })}
            />
          </div>
        )}

        <div className="space-y-2">
          <span className="block text-sm font-medium">{s.colourStops}</span>
          {g.stops.map((stop, i) => (
            // Keyed by a row id, never by the colour: a key that changes as you type
            // remounts the row and the field loses focus after one character.
            <div key={stop.id} className="flex items-center gap-2">
              <input
                type="color"
                value={swatchHex(stop.color)}
                onChange={(e) => updateStop(i, { color: e.target.value.toUpperCase() })}
                aria-label={s.stopPicker.replace('{n}', String(i + 1))}
                className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
              <Input
                value={stop.color}
                onChange={(e) => updateStop(i, { color: e.target.value })}
                aria-label={s.stopColour.replace('{n}', String(i + 1))}
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
                aria-label={s.stopPosition.replace('{n}', String(i + 1))}
                className="h-11 w-24 shrink-0 font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                disabled={g.stops.length <= 2}
                aria-label={s.removeStop.replace('{n}', String(i + 1))}
                onClick={() => setStops(removeRow(g.stops, i))}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStops(appendRow(g.stops, { color: '#FFFFFF', position: 100 }))}
          >
            {s.addStop}
          </Button>
        </div>

        <div>
          <span className="block text-sm font-medium mb-1.5">{s.presets}</span>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {GRADIENT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                title={presetName(p.name)}
                aria-label={presetName(p.name)}
                onClick={() => setG(withRowIds(p.state))}
                className="h-11 rounded-md border transition-transform hover:scale-105"
                style={{ background: toCss(p.state) }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">CSS</span>
            <CopyButton text={toCssBlock(g)} onCopied={countRun} />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toCssBlock(g)}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Tailwind</span>
            <CopyButton text={toTailwind(g)} onCopied={countRun} />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toTailwind(g)}
          </pre>
        </div>

        <div>
          <span className="block text-sm font-medium mb-1.5">{s.editExisting}</span>
          <div className="flex gap-2">
            <Input
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
              }}
              placeholder="background: linear-gradient(90deg, #fff 0%, #000 100%);"
              aria-label={s.pasteCss}
              aria-invalid={importError !== null}
              className="h-11 font-mono"
            />
            <Button className="h-11 shrink-0" onClick={loadCss}>
              {s.loadCss}
            </Button>
          </div>
          {importError && (
            <p className="mt-1.5 text-sm text-destructive" data-testid="import-error">
              {importError}
            </p>
          )}
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
