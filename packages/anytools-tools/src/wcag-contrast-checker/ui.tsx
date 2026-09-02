'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { contrastRatio, parseHex, rateContrast, suggestForeground, toHex } from './logic';

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = parseHex(value) !== null;
  return (
    <div className="flex-1 min-w-[10rem]">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? toHex(parseHex(value) as never) : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0f172a"
          aria-label={`${label} hex`}
          aria-invalid={!valid}
          className="h-11 font-mono"
        />
      </div>
    </div>
  );
}

function PassBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Badge
      className={
        pass ? 'bg-success/10 text-success border-0' : 'bg-destructive/10 text-destructive border-0'
      }
    >
      {label} {pass ? '✓' : '✗'}
    </Badge>
  );
}

export function WcagContrastCheckerUi() {
  const [fgHex, setFgHex] = useState('#10b981');
  const [bgHex, setBgHex] = useState('#f8fafc');

  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const result = useMemo(() => {
    if (!fg || !bg) return null;
    const rating = rateContrast(contrastRatio(fg, bg));
    const suggestion = rating.aaNormal ? null : suggestForeground(fg, bg, 4.5);
    return { rating, suggestion };
  }, [fg, bg]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">WCAG Contrast Checker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <ColorField label="Text color" value={fgHex} onChange={setFgHex} />
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Swap colors"
            onClick={() => {
              setFgHex(bgHex);
              setBgHex(fgHex);
            }}
          >
            <span aria-hidden className="text-base leading-none">
              ⇄
            </span>
          </Button>
          <ColorField label="Background color" value={bgHex} onChange={setBgHex} />
        </div>

        {fg && bg && result ? (
          <>
            <div
              className="rounded-lg border p-6 space-y-1"
              style={{ backgroundColor: toHex(bg), color: toHex(fg) }}
            >
              <p className="text-2xl font-semibold">Large text 24px</p>
              <p className="text-sm">Normal text — the quick brown fox jumps over the lazy dog.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-3xl font-bold tabular-nums">
                {result.rating.ratio.toFixed(2)}:1
              </span>
              <div className="flex flex-wrap gap-2">
                <PassBadge pass={result.rating.aaNormal} label="AA" />
                <PassBadge pass={result.rating.aaLarge} label="AA large" />
                <PassBadge pass={result.rating.aaaNormal} label="AAA" />
                <PassBadge pass={result.rating.aaaLarge} label="AAA large" />
              </div>
            </div>

            {result.suggestion && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
                <span
                  className="h-8 w-8 rounded-md border"
                  style={{ backgroundColor: toHex(result.suggestion) }}
                  aria-hidden
                />
                <div className="text-sm">
                  <p className="font-medium">
                    Closest AA-passing text color: <code>{toHex(result.suggestion)}</code>
                  </p>
                  <p className="text-muted-foreground">Same hue direction, nudged until 4.5:1.</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFgHex(toHex(result.suggestion as never))}
                >
                  Apply
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter valid hex colors (#rgb or #rrggbb) to see the ratio.
          </p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
