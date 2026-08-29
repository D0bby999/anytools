'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  SegmentedControl,
} from '@anytools/ui';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { type TotpOptions, DEFAULT_OPTIONS, currentCode, generateRandomSecret, otpauthUri } from './logic';

export function TotpGeneratorUi() {
  const [secret, setSecret] = useState('');
  const [options, setOptions] = useState<TotpOptions>(DEFAULT_OPTIONS);
  const [issuer, setIssuer] = useState('AnyTools');
  const [label, setLabel] = useState('me@example.com');
  const [now, setNow] = useState(() => Date.now());
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Tick every second so the code and countdown stay live.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const result = useMemo(() => (secret ? currentCode(secret, options, now) : null), [secret, options, now]);
  const uri = useMemo(
    () => (secret ? otpauthUri(secret, label, issuer, options) : null),
    [secret, label, issuer, options],
  );

  useEffect(() => {
    let cancelled = false;
    if (!uri) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(uri, { margin: 1, width: 192 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">TOTP Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block text-sm font-medium mb-1.5">Base32 secret</span>
          <div className="flex gap-2">
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="JBSWY3DPEHPK3PXP"
              aria-label="TOTP secret"
              aria-invalid={secret !== '' && result === null}
              className="h-11 font-mono"
            />
            <Button variant="outline" onClick={() => setSecret(generateRandomSecret())}>
              Random
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <SegmentedControl
            value={String(options.digits)}
            onChange={(v) => setOptions((o) => ({ ...o, digits: Number(v) as 6 | 8 }))}
            options={[
              { value: '6', label: '6 digits' },
              { value: '8', label: '8 digits' },
            ]}
            label="Digits"
          />
          <SegmentedControl
            value={String(options.period)}
            onChange={(v) => setOptions((o) => ({ ...o, period: Number(v) as 30 | 60 }))}
            options={[
              { value: '30', label: '30s' },
              { value: '60', label: '60s' },
            ]}
            label="Period"
          />
        </div>

        {result && (
          <div className="rounded-lg border p-4 text-center space-y-2">
            <div className="flex items-center justify-center gap-3">
              <span className="text-4xl font-mono font-bold tracking-[0.3em]">{result.code}</span>
              <CopyButton text={result.code} />
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
              <div
                className="h-full bg-[var(--color-accent)] transition-[width] duration-1000 ease-linear"
                style={{ width: `${(result.remainingSeconds / result.period) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              refreshes in {result.remainingSeconds}s
            </p>
          </div>
        )}

        {secret !== '' && result === null && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Invalid base32 secret (allowed: A–Z, 2–7).
          </p>
        )}

        {uri && (
          <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start rounded-lg border p-4">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="otpauth QR code" width={144} height={144} className="rounded" />
            )}
            <div className="space-y-2 min-w-0">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  aria-label="Issuer"
                  placeholder="Issuer"
                  className="h-9 text-sm"
                />
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label="Account label"
                  placeholder="account@email"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex items-start gap-2">
                <code className="font-mono text-xs break-all flex-1 text-muted-foreground">{uri}</code>
                <CopyButton text={uri} />
              </div>
              <p className="text-xs text-muted-foreground">
                Scan with Google Authenticator, Aegis, 1Password…
              </p>
            </div>
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
