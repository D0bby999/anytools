'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  CopyButton,
  Input,
  PrivacyNote,
  RangeSlider,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type CrackTime, type PasswordOptions, calculateStrength, generatePassword } from './logic';
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
  // The crack-time estimate arrives as { unit, value }; word it in the locale.
  const crackTimeLabel = ({ unit, value }: CrackTime) =>
    s[`crack_${unit}`].replace('{n}', unit === 'bYears' ? value.toExponential(1) : String(value));
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
                {s.crackTime.replace('{t}', crackTimeLabel(strength.crackTime))}
              </span>
            </div>
          )}
        </div>

        <RangeSlider
          label={s.length}
          value={options.length}
          min={4}
          max={128}
          onChange={(length) => update({ length })}
        />

        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <CheckboxField
            label={s.lowercase}
            checked={options.lowercase}
            onCheckedChange={(v) => update({ lowercase: v === true })}
          />
          <CheckboxField
            label={s.uppercase}
            checked={options.uppercase}
            onCheckedChange={(v) => update({ uppercase: v === true })}
          />
          <CheckboxField
            label={s.numbers}
            checked={options.numbers}
            onCheckedChange={(v) => update({ numbers: v === true })}
          />
          <CheckboxField
            label={s.symbols}
            checked={options.symbols}
            onCheckedChange={(v) => update({ symbols: v === true })}
          />
          <CheckboxField
            label={s.excludeAmbiguous}
            checked={options.excludeAmbiguous}
            onCheckedChange={(v) => update({ excludeAmbiguous: v === true })}
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
