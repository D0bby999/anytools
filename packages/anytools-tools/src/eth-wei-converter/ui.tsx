'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type EthUnit, allConversions } from './logic';

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
  const [value, setValue] = useState('1');
  const [unit, setUnit] = useState<EthUnit>('ether');
  const results = useMemo(() => allConversions(value, unit), [value, unit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">ETH ↔ Wei ↔ Gwei Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef */}
          <label className="text-sm flex-1">
            <span className="block mb-1 text-muted-foreground">Value</span>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="1.5"
              className="font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Unit</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as EthUnit)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-2">
          {UNITS.map((u) => (
            <div key={u.key} className="grid grid-cols-[140px,1fr,auto] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{u.label}</span>
              <code className="font-mono rounded bg-muted px-3 py-1 break-all">
                {results[u.key] || <span className="text-muted-foreground italic">—</span>}
              </code>
              {results[u.key] && <CopyButton text={results[u.key]} />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Uses <code>ethers.parseUnits</code> / <code>formatUnits</code> (BigInt math — no
          floating-point loss).
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
