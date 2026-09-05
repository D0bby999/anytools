'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type PasswordOptions, calculateStrength, generatePassword } from './logic';
import { STRINGS } from './strings';

const STRENGTH_COLOR: Record<string, string> = {
  weak: 'destructive',
  fair: 'secondary',
  strong: 'default',
  excellent: 'default',
};

export function PasswordGeneratorUi() {
  const s = useLocalized(STRINGS);
  // Strength levels are ids from the logic layer; label them in the locale.
  const levelLabel: Record<string, string> = {
    weak: s.levelWeak,
    fair: s.levelFair,
    strong: s.levelStrong,
    excellent: s.levelExcellent,
  };
  const [noteBefore, noteAfter] = s.note.split('{code}');
  const [options, setOptions] = useState<PasswordOptions>({
    length: 20,
    lowercase: true,
    uppercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: true,
  });
  const [password, setPassword] = useState('');

  useEffect(() => {
    try {
      setPassword(generatePassword(options));
    } catch {
      setPassword('');
    }
  }, [options]);

  const regenerate = () => {
    try {
      setPassword(generatePassword(options));
    } catch {
      setPassword('');
    }
  };

  const strength = password ? calculateStrength(password) : null;
  const update = (patch: Partial<PasswordOptions>) => setOptions((prev) => ({ ...prev, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <pre className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
              {password || '—'}
            </pre>
            {password && <CopyButton text={password} />}
          </div>
          {strength && (
            <div className="flex items-center gap-3 text-xs">
              <Badge
                variant={STRENGTH_COLOR[strength.level] as 'default' | 'secondary' | 'destructive'}
              >
                {levelLabel[strength.level] ?? strength.level} ·{' '}
                {s.bits.replace('{n}', String(Math.round(strength.bits)))}
              </Badge>
              <span className="text-muted-foreground">
                {s.crackTime.replace('{t}', strength.crackTimeLabel)}
              </span>
            </div>
          )}
        </div>

        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">
            {s.length} <span className="text-foreground">{options.length}</span>
          </span>
          <input
            type="range"
            min={4}
            max={128}
            value={options.length}
            onChange={(e) => update({ length: Number(e.target.value) })}
            className="w-full"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Toggle
            label={s.lowercase}
            checked={options.lowercase}
            onChange={(v) => update({ lowercase: v })}
          />
          <Toggle
            label={s.uppercase}
            checked={options.uppercase}
            onChange={(v) => update({ uppercase: v })}
          />
          <Toggle
            label={s.numbers}
            checked={options.numbers}
            onChange={(v) => update({ numbers: v })}
          />
          <Toggle
            label={s.symbols}
            checked={options.symbols}
            onChange={(v) => update({ symbols: v })}
          />
          <Toggle
            label={s.excludeAmbiguous}
            checked={options.excludeAmbiguous}
            onChange={(v) => update({ excludeAmbiguous: v })}
          />
        </div>

        <Button onClick={regenerate}>{s.generateNew}</Button>

        <p className="text-xs text-muted-foreground">
          {noteBefore}
          <code>crypto.getRandomValues</code>
          {noteAfter}
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}
