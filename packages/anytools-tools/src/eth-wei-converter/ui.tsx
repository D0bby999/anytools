'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { richText } from '../shared/rich-text';
import { type EthUnit, allConversions } from './logic';
import { STRINGS } from './strings';

// Unit names and exponents are the same in every language; only "smallest" is a word.
const UNITS: { key: EthUnit; label: string }[] = [
  { key: 'ether', label: 'ETH (ether)' },
  { key: 'finney', label: 'finney (10⁻³)' },
  { key: 'szabo', label: 'szabo (10⁻⁶)' },
  { key: 'gwei', label: 'gwei (10⁻⁹)' },
  { key: 'mwei', label: 'mwei (10⁻¹²)' },
  { key: 'kwei', label: 'kwei (10⁻¹⁵)' },
  { key: 'wei', label: 'wei (smallest)' },
];

export function EthWeiConverterUi() {
  const s = useLocalized(STRINGS);
  const [value, setValue] = useState('1');
  const [unit, setUnit] = useState<EthUnit>('ether');
  const results = useMemo(() => allConversions(value, unit), [value, unit]);
  const unitLabel = (u: (typeof UNITS)[number]) => (u.key === 'wei' ? s.weiSmallest : u.label);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef */}
          <label className="text-sm flex-1">
            <span className="block mb-1 text-muted-foreground">{s.value}</span>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="1.5"
              className="font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.unit}</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as EthUnit)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-2">
          {UNITS.map((u) => (
            <div key={u.key} className="grid grid-cols-[140px,1fr,auto] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{unitLabel(u)}</span>
              <code className="font-mono rounded bg-muted px-3 py-1 break-all">
                {results[u.key] || <span className="text-muted-foreground italic">—</span>}
              </code>
              {results[u.key] && <CopyButton text={results[u.key]} />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {richText(s.note, {
            parse: <code>ethers.parseUnits</code>,
            format: <code>formatUnits</code>,
          })}
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
