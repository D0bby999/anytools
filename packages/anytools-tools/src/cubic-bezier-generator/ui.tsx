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
  useLocalized,
} from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { BezierCanvas } from './bezier-canvas';
import {
  type CubicBezier,
  clampControlPoint,
  easingValueAt,
  parseCoordinate,
  toCssVariable,
  toTransitionTimingFunction,
} from './logic';
import { CSS_KEYWORD_PRESETS, OVERSHOOT_PRESETS } from './presets';
import { STRINGS } from './strings';

const SLUG = 'cubic-bezier-generator';
const DEFAULT: CubicBezier = CSS_KEYWORD_PRESETS[1]?.bezier ?? {
  x1: 0.25,
  y1: 0.1,
  x2: 0.25,
  y2: 1,
};
// Preset names are plain English identifiers in presets.ts; look up the localized label by
// stripping hyphens the same way strings.ts keys are named (`ease-in-back` -> `preset_easeinback`).
const presetKey = (name: string) => `preset_${name.replace(/-/g, '')}`;

export function CubicBezierGeneratorUi() {
  const s = useLocalized(STRINGS);
  const [bezier, setBezier] = useState<CubicBezier>(DEFAULT);
  const [durationMs, setDurationMs] = useState(800);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const counted = useRef(false);

  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };

  // requestAnimationFrame loop, not setInterval: it stays in step with the browser's own
  // repaint cadence, which is what a "does this easing feel right" preview needs to be honest.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(easingValueAt(t, bezier));
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        setPlaying(false);
        setHasPlayed(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Dragging a handle or changing the duration mid-play restarts the loop from t=0 with the
    // new curve — a fresh, understandable replay rather than a jump partway through a new shape.
  }, [playing, durationMs, bezier]);

  // The button is disabled while playing (below), so this only ever starts a fresh run.
  const play = () => {
    setProgress(0);
    countRun();
    setPlaying(true);
  };

  // x1/x2 are clamped into [0,1] (CSS requirement); y1/y2 accept whatever was typed, including
  // outside [0,1] for overshoot — see logic.ts header for why the two axes differ.
  const setCoord = (key: keyof CubicBezier, text: string) => {
    const n = parseCoordinate(text);
    if (n === null) return;
    setBezier((prev) => ({
      ...prev,
      [key]: key === 'x1' || key === 'x2' ? clampControlPoint({ x: n, y: 0 }).x : n,
    }));
  };

  const cssBlock = toTransitionTimingFunction(bezier);
  const variableBlock = toCssVariable('ease-custom', bezier);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-center">
          <BezierCanvas bezier={bezier} onChange={setBezier} />
        </div>
        <p className="text-sm text-muted-foreground">{s.hint}</p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically
            <label key={key} className="text-sm">
              <span className="mb-1 block text-muted-foreground">{key}</span>
              <Input
                type="number"
                step={0.01}
                value={bezier[key]}
                onChange={(e) => setCoord(key, e.target.value)}
                className="h-11 font-mono"
              />
            </label>
          ))}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{s.cssKeywords}</span>
          <div className="flex flex-wrap gap-2">
            {CSS_KEYWORD_PRESETS.map((p) => (
              <Button
                key={p.name}
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => setBezier(p.bezier)}
              >
                {(s as Record<string, string>)[presetKey(p.name)] ?? p.name}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{s.overshoot}</span>
          <div className="flex flex-wrap gap-2">
            {OVERSHOOT_PRESETS.map((p) => (
              <Button
                key={p.name}
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => setBezier(p.bezier)}
              >
                {(s as Record<string, string>)[presetKey(p.name)] ?? p.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{s.preview}</span>
            <div className="flex items-center gap-2">
              <RangeSlider
                className="w-40"
                label={s.duration}
                unit="ms"
                min={200}
                max={3000}
                step={100}
                value={durationMs}
                onChange={setDurationMs}
              />
              <Button size="sm" onClick={play} disabled={playing}>
                {hasPlayed ? s.replay : s.play}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{s.previewHint}</p>
          <div className="relative h-14 overflow-visible rounded-md bg-muted">
            {/* The block is 32px (w-8) wide; subtracting progress*32px keeps it fully inside the
                track at progress=1 instead of overflowing past the right edge by its own width. */}
            <div
              className="absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-md bg-indigo-600 shadow"
              style={{ left: `calc(${progress * 100}% - ${progress * 32}px)` }}
              data-testid="bezier-preview-ball"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{s.cssOutput}</span>
            <CopyButton text={cssBlock} onCopied={countRun} />
          </div>
          <pre
            className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono"
            data-testid="bezier-css"
          >
            {cssBlock}
          </pre>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{s.variableOutput}</span>
            <CopyButton text={variableBlock} onCopied={countRun} />
          </div>
          <pre
            className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono"
            data-testid="bezier-variable"
          >
            {variableBlock}
          </pre>
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
