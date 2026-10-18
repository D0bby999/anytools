import { CalculatorTemplate, ColorInput, Input, TableResult, useLocalized } from '~/components/tools-ui';
import { useState } from 'react';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
  contrastRatio,
  formatHsl,
  formatRgb,
  hexToRgb,
  rgbToHsl,
} from './logic';
import { STRINGS } from './strings';

export function ColorConverterUi() {
  const s = useLocalized(STRINGS);
  const [fg, setFg] = useState(DEFAULT_FOREGROUND);
  const [bg, setBg] = useState(DEFAULT_BACKGROUND);

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
            <ColorInput label={s.foreground} value={fg} onChange={setFg} />
            {fgRgb && fgHsl && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {formatRgb(fgRgb)} · {formatHsl(fgHsl)}
              </p>
            )}
          </div>
          <div>
            <ColorInput label={s.background} value={bg} onChange={setBg} />
            {bgRgb && bgHsl && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {formatRgb(bgRgb)} · {formatHsl(bgHsl)}
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
        setFg(DEFAULT_FOREGROUND);
        setBg(DEFAULT_BACKGROUND);
      }}
    />
  );
}
