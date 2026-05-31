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
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type PasswordOptions, calculateStrength, generatePassword } from './logic';

const STRENGTH_COLOR: Record<string, string> = {
  weak: 'destructive',
  fair: 'secondary',
  strong: 'default',
  excellent: 'default',
};

export function PasswordGeneratorUi() {
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
        <CardTitle className="text-xl">Password Generator</CardTitle>
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
                {strength.level} · {Math.round(strength.bits)} bits
              </Badge>
              <span className="text-muted-foreground">
                est. crack time: {strength.crackTimeLabel}
              </span>
            </div>
          )}
        </div>

        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">
            Length: <span className="text-foreground">{options.length}</span>
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
            label="Lowercase a–z"
            checked={options.lowercase}
            onChange={(v) => update({ lowercase: v })}
          />
          <Toggle
            label="Uppercase A–Z"
            checked={options.uppercase}
            onChange={(v) => update({ uppercase: v })}
          />
          <Toggle
            label="Numbers 0–9"
            checked={options.numbers}
            onChange={(v) => update({ numbers: v })}
          />
          <Toggle
            label="Symbols !@#…"
            checked={options.symbols}
            onChange={(v) => update({ symbols: v })}
          />
          <Toggle
            label="Exclude ambiguous (0,O,l,1,I)"
            checked={options.excludeAmbiguous}
            onChange={(v) => update({ excludeAmbiguous: v })}
          />
        </div>

        <Button onClick={regenerate}>Generate new</Button>

        <p className="text-xs text-muted-foreground">
          Generated with <code>crypto.getRandomValues</code>. For storage, hash with bcrypt /
          Argon2, never with plain SHA.
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
