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
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { inspect } from './logic';

export function WalletCheckerUi() {
  const [address, setAddress] = useState('');
  const result = useMemo(() => (address ? inspect(address) : null), [address]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Wallet Address Checker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Paste ETH, BTC, or SOL address"
          className="font-mono"
        />
        {result &&
          (result.valid ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge>{result.kind.toUpperCase()}</Badge>
                {result.subtype && <Badge variant="secondary">{result.subtype}</Badge>}
                {result.checksum && <Badge variant="default">Checksum ✓</Badge>}
              </div>
              <div className="rounded-md border bg-muted px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Canonical
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
        <PrivacyNote message="Address validation runs in your browser. We do not query any blockchain or external API." />
      </CardContent>
    </Card>
  );
}
