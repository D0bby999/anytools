'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type LoremOutput, type LoremUnit, type LoremVariant, generateLorem } from './logic';

const VARIANTS: { value: LoremVariant; label: string }[] = [
  { value: 'classic', label: 'Classic Lorem' },
  { value: 'vietnamese', label: 'Vietnamese' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'hipster', label: 'Hipster' },
];

const UNITS: LoremUnit[] = ['paragraphs', 'sentences', 'words'];
const OUTPUTS: LoremOutput[] = ['plain', 'html'];

export function LoremIpsumGeneratorUi() {
  const [variant, setVariant] = useState<LoremVariant>('classic');
  const [unit, setUnit] = useState<LoremUnit>('paragraphs');
  const [count, setCount] = useState(3);
  const [output, setOutput] = useState<LoremOutput>('plain');
  const [regenKey, setRegenKey] = useState(0);

  const text = useMemo(
    () => generateLorem({ variant, unit, count, output }),
    // include regenKey to trigger fresh randomness on button click
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, unit, count, output, regenKey],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Lorem Ipsum Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Variant</span>
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as LoremVariant)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Unit</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as LoremUnit)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Count (1–500)</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Output</span>
            <select
              value={output}
              onChange={(e) => setOutput(e.target.value as LoremOutput)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {OUTPUTS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setRegenKey((k) => k + 1)}>Regenerate</Button>
          <CopyButton text={text} />
        </div>

        <Textarea value={text} readOnly rows={12} className="font-mono text-sm" />

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
