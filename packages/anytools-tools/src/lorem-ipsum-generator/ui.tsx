'use client';
import {
  GeneratorTemplate,
  Input,
  Label,
  PrivacyNote,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useId, useMemo, useState } from 'react';
import { type LoremOutput, type LoremUnit, type LoremVariant, generateLorem } from './logic';
import { STRINGS } from './strings';

const VARIANTS: LoremVariant[] = ['classic', 'vietnamese', 'spanish', 'hipster'];
const UNITS: LoremUnit[] = ['paragraphs', 'sentences', 'words'];
const OUTPUTS: LoremOutput[] = ['plain', 'html'];

export function LoremIpsumGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const countId = useId();
  const variantLabel: Record<LoremVariant, string> = {
    classic: s.variantClassic,
    vietnamese: s.variantVietnamese,
    spanish: s.variantSpanish,
    hipster: s.variantHipster,
  };
  const unitLabel: Record<LoremUnit, string> = {
    paragraphs: s.unitParagraphs,
    sentences: s.unitSentences,
    words: s.unitWords,
  };
  const outputLabel: Record<LoremOutput, string> = { plain: s.outputPlain, html: s.outputHtml };
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
    <GeneratorTemplate
      title={s.title}
      primaryActionLabel={s.regenerate}
      onGenerate={() => setRegenKey((k) => k + 1)}
      outputLabel={ui.output}
      output={text}
      form={
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="lorem-variant">{s.variant}</Label>
            <Select value={variant} onValueChange={(v) => setVariant(v as LoremVariant)}>
              <SelectTrigger id="lorem-variant">
                <SelectValue>{variantLabel[variant]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {variantLabel[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lorem-unit">{s.unit}</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as LoremUnit)}>
              <SelectTrigger id="lorem-unit">
                <SelectValue>{unitLabel[unit]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {unitLabel[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={countId}>{s.count}</Label>
            <Input
              id={countId}
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lorem-output">{ui.output}</Label>
            <Select value={output} onValueChange={(v) => setOutput(v as LoremOutput)}>
              <SelectTrigger id="lorem-output">
                <SelectValue>{outputLabel[output]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OUTPUTS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {outputLabel[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
      outputDisplay={
        <div className="space-y-3">
          <Textarea value={text} readOnly rows={12} className="font-mono text-sm" />
          <PrivacyNote />
        </div>
      }
    />
  );
}
