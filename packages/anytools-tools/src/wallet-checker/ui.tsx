'use client';
import {
  Badge,
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
import { inspect } from './logic';
import { STRINGS } from './strings';

export function WalletCheckerUi() {
  const s = useLocalized(STRINGS);
  const [address, setAddress] = useState('');
  const result = useMemo(() => (address ? inspect(address) : null), [address]);

  // logic.ts labels subtypes in English; its stable ids pick the label in this language.
  const subtypeLabel: Record<string, string> = {
    evmValid: s.evmValid,
    evmMismatch: s.evmMismatch,
    bech32: s.bech32,
    legacy: s.legacy,
    segwitWrapped: s.segwitWrapped,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={s.placeholder}
          className="font-mono"
        />
        {result &&
          (result.valid ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge>{result.kind.toUpperCase()}</Badge>
                {result.subtype && (
                  <Badge variant="secondary">
                    {(result.subtypeId && subtypeLabel[result.subtypeId]) ?? result.subtype}
                  </Badge>
                )}
                {result.checksum && <Badge variant="default">{s.checksum}</Badge>}
              </div>
              <div className="rounded-md border bg-muted px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {s.canonical}
                  </span>
                  <CopyButton text={result.canonical} />
                </div>
                <code className="font-mono text-sm break-all">{result.canonical}</code>
              </div>
            </div>
          ) : (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {s[`error_${result.code}`] ?? result.error}
            </output>
          ))}
        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}
