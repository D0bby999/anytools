'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { decodeJwt, readExpiry } from './logic';

const EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

export function JwtDecoderUi() {
  const [token, setToken] = useState('');

  const decoded = useMemo(() => {
    if (token.trim().length === 0) return null;
    try {
      const result = decodeJwt(token);
      const expiry = readExpiry(result.payload);
      return { ok: true as const, result, expiry };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Decode failed' };
    }
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">JWT Decoder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={EXAMPLE}
          rows={5}
          aria-label="JWT token"
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setToken(EXAMPLE)}>
            Try example
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setToken('')}
            disabled={token.length === 0}
          >
            Clear
          </Button>
        </div>

        {!decoded ? (
          <p className="text-sm text-muted-foreground italic">Paste a JWT to decode.</p>
        ) : !decoded.ok ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {decoded.error}
          </output>
        ) : (
          <div className="space-y-4">
            {decoded.expiry.exp && (
              <div>
                {decoded.expiry.isExpired ? (
                  <Badge variant="destructive">
                    Expired {Math.abs(decoded.expiry.expiresInSec ?? 0)}s ago
                  </Badge>
                ) : (
                  <Badge>Valid for {decoded.expiry.expiresInSec}s</Badge>
                )}
              </div>
            )}
            <Section title="Header" data={decoded.result.header} />
            <Section title="Payload" data={decoded.result.payload} />
            <SignatureBlock raw={decoded.result.signature} />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Decoded in your browser. Never store or send JWTs that contain secrets to third-party
          tools.
        </p>
      </CardContent>
    </Card>
  );
}

function Section({ title, data }: { title: string; data: object }) {
  const json = JSON.stringify(data, null, 2);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{title}</span>
        <CopyButton text={json} />
      </div>
      <pre className="rounded-md border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-all">
        {json}
      </pre>
    </div>
  );
}

function SignatureBlock({ raw }: { raw: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Signature (raw)
        </span>
        <CopyButton text={raw} />
      </div>
      <pre className="rounded-md border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-all opacity-70">
        {raw}
      </pre>
      <p className="text-xs text-muted-foreground mt-1">
        Signature verification requires the issuer&apos;s key — intentionally not exposed in this
        client-side tool.
      </p>
    </div>
  );
}
