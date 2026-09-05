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
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useRef, useState } from 'react';
import {
  DEFAULT_LAYER,
  type LayerRow,
  type ShadowLayer,
  joinColor,
  makeLayerRow,
  makeLayerRows,
  removeLayerRow,
  splitColor,
  toCss,
  toCssBlock,
  toTailwind,
  updateLayerRow,
} from './logic';
import { SHADOW_PRESETS } from './presets';
import { STRINGS } from './strings';

const SLUG = 'box-shadow-generator';
const NUMBER_KEYS = ['x', 'y', 'blur', 'spread'] as const;

function PreviewCard({ dark, shadow }: { dark: boolean; shadow: string }) {
  return (
    <div
      className="flex h-40 items-center justify-center rounded-lg border"
      style={{ backgroundColor: dark ? '#0b1220' : '#f8fafc' }}
    >
      <div
        className="h-20 w-32 rounded-lg"
        style={{ backgroundColor: dark ? '#1e293b' : '#ffffff', boxShadow: shadow }}
      />
    </div>
  );
}

export function BoxShadowGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [layers, setLayers] = useState<LayerRow[]>(() =>
    makeLayerRows(SHADOW_PRESETS[2]?.layers ?? [DEFAULT_LAYER]),
  );
  // `tool_run` counts sessions that got something out of the tool, so it fires once per
  // mount: one visitor copying five variants is one run, and a visitor who copies
  // nothing is none.
  const counted = useRef(false);
  const css = toCss(layers);

  // X and Y are axis names; only blur and spread read as words.
  const numberLabel: Record<(typeof NUMBER_KEYS)[number], string> = {
    x: 'X',
    y: 'Y',
    blur: s.blur,
    spread: s.spread,
  };
  // "Material N" / "Tailwind …" are product names; only "Inner" is a word to translate.
  const presetName = (name: string) => (name === 'Inner' ? s.preset_inner : name);

  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };
  const update = (i: number, patch: Partial<ShadowLayer>) =>
    setLayers(updateLayerRow(layers, i, patch));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PreviewCard dark={false} shadow={css} />
          <PreviewCard dark shadow={css} />
        </div>

        <div>
          <span className="block text-sm font-medium mb-1.5">{s.presets}</span>
          <div className="flex flex-wrap gap-2">
            {SHADOW_PRESETS.map((p) => (
              <Button
                key={p.name}
                variant="outline"
                size="sm"
                onClick={() => setLayers(makeLayerRows(p.layers))}
                className="h-11"
              >
                {presetName(p.name)}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <span className="block text-sm font-medium">{s.layersHint}</span>
          {layers.map((layer, i) => {
            const { hex, alpha } = splitColor(layer.color);
            const n = String(i + 1);
            return (
              // Keyed by a row id, never by the colour: a key that changes as the
              // colour changes remounts the row, and the field being typed into (or the
              // alpha slider being dragged) loses focus after one step.
              <div
                key={layer.id}
                className="rounded-lg border p-3 space-y-3"
                data-testid="shadow-layer"
              >
                <div className="flex flex-wrap items-end gap-3">
                  {NUMBER_KEYS.map((key) => (
                    <div key={key} className="w-20">
                      <span className="block text-xs font-medium mb-1">{numberLabel[key]}</span>
                      <Input
                        type="number"
                        value={layer[key]}
                        min={key === 'blur' ? 0 : undefined}
                        onChange={(e) => update(i, { [key]: Number(e.target.value) })}
                        aria-label={s.layerField
                          .replace('{n}', n)
                          .replace('{field}', numberLabel[key])}
                        className="h-11 font-mono"
                      />
                    </div>
                  ))}
                  <div>
                    <span className="block text-xs font-medium mb-1">{s.colour}</span>
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => update(i, { color: joinColor(e.target.value, alpha) })}
                      aria-label={s.layerColour.replace('{n}', n)}
                      className="h-11 w-11 cursor-pointer rounded-md border border-input bg-transparent p-1"
                    />
                  </div>
                  <div className="w-32">
                    <span className="block text-xs font-medium mb-1">
                      {s.alpha.replace('{pct}', String(Math.round(alpha * 100)))}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(alpha * 100)}
                      onChange={(e) =>
                        update(i, { color: joinColor(hex, Number(e.target.value) / 100) })
                      }
                      aria-label={s.layerAlpha.replace('{n}', n)}
                      className="h-11 w-full"
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={layer.inset}
                      onChange={(e) => update(i, { inset: e.target.checked })}
                    />
                    {s.inset}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11"
                    aria-label={s.removeLayer.replace('{n}', n)}
                    onClick={() => setLayers(removeLayerRow(layers, i))}
                  >
                    {ui.remove}
                  </Button>
                </div>
                <code className="block text-xs text-muted-foreground font-mono">
                  {toCss([layer])}
                </code>
              </div>
            );
          })}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLayers([...layers, makeLayerRow(DEFAULT_LAYER)])}
          >
            {s.addLayer}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">CSS</span>
            <CopyButton text={toCssBlock(layers)} onCopied={countRun} />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toCssBlock(layers)}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Tailwind</span>
            <CopyButton text={toTailwind(layers)} onCopied={countRun} />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono">
            {toTailwind(layers)}
          </pre>
        </div>

        {layers.length > 3 && (
          <p className="text-sm text-muted-foreground">
            {s.manyLayers.replace('{n}', String(layers.length))}
          </p>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
