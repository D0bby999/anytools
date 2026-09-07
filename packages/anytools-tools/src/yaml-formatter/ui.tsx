'use client';
import {
  CheckboxField,
  ConverterTemplate,
  CopyButton,
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
import { useMemo, useState } from 'react';
import { formatYaml } from './logic';
import { STRINGS } from './strings';

export function YamlFormatterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [sortKeys, setSortKeys] = useState(false);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    return formatYaml(input, indent, sortKeys);
  }, [input, indent, sortKeys]);

  return (
    <ConverterTemplate
      title={s.title}
      toolbar={
        <>
          <div className="space-y-1.5">
            <Label htmlFor="yaml-indent">{ui.indent}</Label>
            <Select value={String(indent)} onValueChange={(v) => setIndent(Number(v) as 2 | 4)}>
              <SelectTrigger id="yaml-indent" className="min-w-28">
                <SelectValue>{indent === 4 ? ui.spaces4 : ui.spaces2}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">{ui.spaces2}</SelectItem>
                <SelectItem value="4">{ui.spaces4}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CheckboxField
            label={ui.sortKeys}
            checked={sortKeys}
            onCheckedChange={(v) => setSortKeys(v === true)}
          />
        </>
      }
      source={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input}
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'key: value\nlist:\n  - item'}
            rows={14}
            className="h-full"
            aria-label={ui.input}
          />
        </div>
      }
      target={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.output}
            </span>
            {result.ok && result.value && <CopyButton text={result.value} />}
          </div>
          {result.ok ? (
            <pre className="min-h-[336px] whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {result.value || <span className="italic text-muted-foreground">—</span>}
            </pre>
          ) : (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.error}
            </output>
          )}
        </div>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
