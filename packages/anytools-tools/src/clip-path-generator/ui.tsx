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
import { ClipCanvas } from './clip-canvas';
import { type Box, type ClipShape, type Unit, toCss, toCssBlock } from './logic';
import { CLIP_PRESETS } from './presets';

const SLUG = 'clip-path-generator';
type Kind = ClipShape['kind'];

const BLANK: Record<Kind, ClipShape> = {
  polygon: CLIP_PRESETS[0]?.shape ?? { kind: 'polygon', points: [] },
  circle: { kind: 'circle', r: 50, cx: 50, cy: 50 },
  ellipse: { kind: 'ellipse', rx: 40, ry: 25, cx: 50, cy: 50 },
  inset: { kind: 'inset', top: 10, right: 10, bottom: 10, left: 10, round: 0 },
};

export function ClipPathGeneratorUi() {
  const [shape, setShape] = useState<ClipShape>(BLANK.polygon);
  const [unit, setUnit] = useState<Unit>('%');
  const [box, setBox] = useState<Box>({ width: 400, height: 320 });

  const declaration = toCssBlock(shape, unit, box);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">CSS Clip Path Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ClipCanvas shape={shape} onChange={setShape} />
        <p className="text-sm text-muted-foreground">
          Drag a vertex to move it, or focus one and use the arrow keys. The small squares on each
          edge add a vertex there; Delete on a vertex removes it (three is the minimum).
        </p>

        <SegmentedControl
          label="Shape"
          value={shape.kind}
          onChange={(kind: Kind) => setShape(BLANK[kind])}
          options={[
            { value: 'polygon', label: 'Polygon' },
            { value: 'circle', label: 'Circle' },
            { value: 'ellipse', label: 'Ellipse' },
            { value: 'inset', label: 'Inset' },
          ]}
        />

        {shape.kind === 'polygon' && (
          <div>
            <span className="block text-sm font-medium mb-1.5">Presets</span>
            <div className="flex flex-wrap gap-2">
              {CLIP_PRESETS.map((p) => (
                <Button
                  key={p.name}
                  variant="outline"
                  size="sm"
                  className="h-11"
                  onClick={() => setShape(p.shape)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {shape.kind === 'circle' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RangeSlider
              label="Radius"
              unit="%"
              min={0}
              max={100}
              value={shape.r}
              onChange={(r) => setShape({ ...shape, r })}
            />
            <RangeSlider
              label="Centre X"
              unit="%"
              min={0}
              max={100}
              value={shape.cx}
              onChange={(cx) => setShape({ ...shape, cx })}
            />
            <RangeSlider
              label="Centre Y"
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
              label="Radius X"
              unit="%"
              min={0}
              max={100}
              value={shape.rx}
              onChange={(rx) => setShape({ ...shape, rx })}
            />
            <RangeSlider
              label="Radius Y"
              unit="%"
              min={0}
              max={100}
              value={shape.ry}
              onChange={(ry) => setShape({ ...shape, ry })}
            />
            <RangeSlider
              label="Centre X"
              unit="%"
              min={0}
              max={100}
              value={shape.cx}
              onChange={(cx) => setShape({ ...shape, cx })}
            />
            <RangeSlider
              label="Centre Y"
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
              label="Top"
              unit="%"
              min={0}
              max={50}
              value={shape.top}
              onChange={(top) => setShape({ ...shape, top })}
            />
            <RangeSlider
              label="Right"
              unit="%"
              min={0}
              max={50}
              value={shape.right}
              onChange={(right) => setShape({ ...shape, right })}
            />
            <RangeSlider
              label="Bottom"
              unit="%"
              min={0}
              max={50}
              value={shape.bottom}
              onChange={(bottom) => setShape({ ...shape, bottom })}
            />
            <RangeSlider
              label="Left"
              unit="%"
              min={0}
              max={50}
              value={shape.left}
              onChange={(left) => setShape({ ...shape, left })}
            />
            <RangeSlider
              label="Corner radius"
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
            label="Units"
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
                <span className="block text-sm font-medium mb-1.5">Box width</span>
                <Input
                  type="number"
                  min={1}
                  value={box.width}
                  onChange={(e) => setBox({ ...box, width: Number(e.target.value) })}
                  aria-label="Reference box width in px"
                  className="h-11 font-mono"
                />
              </div>
              <div className="w-28">
                <span className="block text-sm font-medium mb-1.5">Box height</span>
                <Input
                  type="number"
                  min={1}
                  value={box.height}
                  onChange={(e) => setBox({ ...box, height: Number(e.target.value) })}
                  aria-label="Reference box height in px"
                  className="h-11 font-mono"
                />
              </div>
            </>
          )}
        </div>
        {unit === 'px' && (
          <p className="text-sm text-muted-foreground">
            px values are frozen at this box size — the shape will not follow a responsive element.
            Percentages are the safer default.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">CSS</span>
            <CopyButton
              text={declaration}
              onCopied={() => trackEvent('tool_run', { tool: SLUG })}
            />
          </div>
          <pre
            className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono"
            data-testid="clip-css"
          >
            {declaration}
          </pre>
          {shape.kind === 'polygon' && (
            <p className="text-xs text-muted-foreground">
              {shape.points.length} vertices · value: <code>{toCss(shape)}</code>
            </p>
          )}
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
