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
import { richText } from '../shared/rich-text';
import { ClipCanvas } from './clip-canvas';
import { type Box, type ClipShape, type Unit, parseBoxSide, toCss, toCssBlock } from './logic';
import { CLIP_PRESETS } from './presets';
import { STRINGS } from './strings';

const SLUG = 'clip-path-generator';
type Kind = ClipShape['kind'];

const BLANK: Record<Kind, ClipShape> = {
  polygon: CLIP_PRESETS[0]?.shape ?? { kind: 'polygon', points: [] },
  circle: { kind: 'circle', r: 50, cx: 50, cy: 50 },
  ellipse: { kind: 'ellipse', rx: 40, ry: 25, cx: 50, cy: 50 },
  inset: { kind: 'inset', top: 10, right: 10, bottom: 10, left: 10, round: 0 },
};

export function ClipPathGeneratorUi() {
  const s = useLocalized(STRINGS);
  const [shape, setShape] = useState<ClipShape>(BLANK.polygon);
  const [unit, setUnit] = useState<Unit>('%');
  const [box, setBox] = useState<Box>({ width: 400, height: 320 });
  // What the two px fields show. It is separate from `box` so a half-typed or cleared
  // field keeps the last usable size in the CSS instead of collapsing it to zero.
  const [boxText, setBoxText] = useState({ width: '400', height: '320' });
  // `tool_run` counts sessions that got something out of the tool, so it fires once per
  // mount: one visitor copying five shapes is one run, and a visitor who copies nothing
  // is none.
  const counted = useRef(false);

  const declaration = toCssBlock(shape, unit, box);
  const boxIsStale = parseBoxSide(boxText.width) === null || parseBoxSide(boxText.height) === null;
  // Preset names live in presets.ts in English; look them up by name here.
  const presetName = (name: string) =>
    (s as Record<string, string>)[`preset_${name.replace(/\s+/g, '')}`] ?? name;

  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };

  const setSide = (side: 'width' | 'height', text: string) => {
    setBoxText((prev) => ({ ...prev, [side]: text }));
    const value = parseBoxSide(text);
    if (value !== null) setBox((prev) => ({ ...prev, [side]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ClipCanvas shape={shape} onChange={setShape} />
        <p className="text-sm text-muted-foreground">{s.hint}</p>

        <SegmentedControl
          label={s.shape}
          value={shape.kind}
          onChange={(kind: Kind) => setShape(BLANK[kind])}
          options={[
            { value: 'polygon', label: s.polygon },
            { value: 'circle', label: s.circle },
            { value: 'ellipse', label: s.ellipse },
            { value: 'inset', label: s.inset },
          ]}
        />

        {shape.kind === 'polygon' && (
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.presets}</span>
            <div className="flex flex-wrap gap-2">
              {CLIP_PRESETS.map((p) => (
                <Button
                  key={p.name}
                  variant="outline"
                  size="sm"
                  className="h-11"
                  onClick={() => setShape(p.shape)}
                >
                  {presetName(p.name)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {shape.kind === 'circle' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RangeSlider
              label={s.radius}
              unit="%"
              min={0}
              max={100}
              value={shape.r}
              onChange={(r) => setShape({ ...shape, r })}
            />
            <RangeSlider
              label={s.centreX}
              unit="%"
              min={0}
              max={100}
              value={shape.cx}
              onChange={(cx) => setShape({ ...shape, cx })}
            />
            <RangeSlider
              label={s.centreY}
              unit="%"
              min={0}
              max={100}
              value={shape.cy}
              onChange={(cy) => setShape({ ...shape, cy })}
            />
          </div>
        )}

        {shape.kind === 'ellipse' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RangeSlider
              label={s.radiusX}
              unit="%"
              min={0}
              max={100}
              value={shape.rx}
              onChange={(rx) => setShape({ ...shape, rx })}
            />
            <RangeSlider
              label={s.radiusY}
              unit="%"
              min={0}
              max={100}
              value={shape.ry}
              onChange={(ry) => setShape({ ...shape, ry })}
            />
            <RangeSlider
              label={s.centreX}
              unit="%"
              min={0}
              max={100}
              value={shape.cx}
              onChange={(cx) => setShape({ ...shape, cx })}
            />
            <RangeSlider
              label={s.centreY}
              unit="%"
              min={0}
              max={100}
              value={shape.cy}
              onChange={(cy) => setShape({ ...shape, cy })}
            />
          </div>
        )}

        {shape.kind === 'inset' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RangeSlider
              label={s.top}
              unit="%"
              min={0}
              max={50}
              value={shape.top}
              onChange={(top) => setShape({ ...shape, top })}
            />
            <RangeSlider
              label={s.right}
              unit="%"
              min={0}
              max={50}
              value={shape.right}
              onChange={(right) => setShape({ ...shape, right })}
            />
            <RangeSlider
              label={s.bottom}
              unit="%"
              min={0}
              max={50}
              value={shape.bottom}
              onChange={(bottom) => setShape({ ...shape, bottom })}
            />
            <RangeSlider
              label={s.left}
              unit="%"
              min={0}
              max={50}
              value={shape.left}
              onChange={(left) => setShape({ ...shape, left })}
            />
            <RangeSlider
              label={s.cornerRadius}
              unit="%"
              min={0}
              max={50}
              value={shape.round}
              onChange={(r) => setShape({ ...shape, round: r })}
            />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl
            className="w-40"
            label={s.units}
            value={unit}
            onChange={setUnit}
            options={[
              { value: '%', label: '%' },
              { value: 'px', label: 'px' },
            ]}
          />
          {unit === 'px' && (
            <>
              <div className="w-28">
                <span className="block text-sm font-medium mb-1.5">{s.boxWidth}</span>
                <Input
                  type="number"
                  min={1}
                  value={boxText.width}
                  onChange={(e) => setSide('width', e.target.value)}
                  aria-label={s.boxWidthAria}
                  className="h-11 font-mono"
                />
              </div>
              <div className="w-28">
                <span className="block text-sm font-medium mb-1.5">{s.boxHeight}</span>
                <Input
                  type="number"
                  min={1}
                  value={boxText.height}
                  onChange={(e) => setSide('height', e.target.value)}
                  aria-label={s.boxHeightAria}
                  className="h-11 font-mono"
                />
              </div>
            </>
          )}
        </div>
        {unit === 'px' && <p className="text-sm text-muted-foreground">{s.pxNote}</p>}
        {unit === 'px' && boxIsStale && (
          <p className="text-sm text-destructive" data-testid="box-warning">
            {s.boxWarning.replace('{w}', String(box.width)).replace('{h}', String(box.height))}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">CSS</span>
            <CopyButton text={declaration} onCopied={countRun} />
          </div>
          <pre
            className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono"
            data-testid="clip-css"
          >
            {declaration}
          </pre>
          {shape.kind === 'polygon' && (
            <p className="text-xs text-muted-foreground">
              {richText(s.verticesValue, {
                n: String(shape.points.length),
                code: <code>{toCss(shape)}</code>,
              })}
            </p>
          )}
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
