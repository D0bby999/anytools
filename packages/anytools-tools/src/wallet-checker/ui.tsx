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

  // logic.ts names subtypes in English; map them by exact text, falling back to the original.
  const subtypeLabel: Record<string, string> = {
    'EVM (EIP-55 valid)': s.evmValid,
    'EVM (checksum mismatch)': s.evmMismatch,
    'bech32 (native segwit)': s.bech32,
    'legacy (P2PKH)': s.legacy,
    'segwit-wrapped (P2SH)': s.segwitWrapped,
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
                    {subtypeLabel[result.subtype] ?? result.subtype}
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
              {result.error}
            </output>
          ))}
        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}
