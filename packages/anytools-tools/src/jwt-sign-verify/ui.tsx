'use client';
import { trackEvent } from '@anytools/analytics';
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
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import {
  SIGN_ALGORITHMS,
  type SignAlgorithm,
  type VerifyResult,
  signJwt,
  verifyJwt,
} from './logic';
import { STRINGS } from './strings';

const EXAMPLE_PAYLOAD = '{\n  "sub": "1234567890",\n  "name": "John Doe"\n}';
const ALGO_OPTIONS = SIGN_ALGORITHMS.map((a) => ({ value: a, label: a }));

const STATUS_VARIANT: Record<VerifyResult['status'], 'default' | 'destructive'> = {
  valid: 'default',
  invalidSignature: 'destructive',
  expired: 'destructive',
  notYetValid: 'destructive',
  algRejected: 'destructive',
  malformed: 'destructive',
};

export function JwtSignVerifyUi() {
  const s = useLocalized(STRINGS);
  const [mode, setMode] = useState<'sign' | 'verify'>('sign');

  // Sign tab
  const [signAlgorithm, setSignAlgorithm] = useState<SignAlgorithm>('HS256');
  const [payloadJson, setPayloadJson] = useState(EXAMPLE_PAYLOAD);
  const [signKey, setSignKey] = useState('');
  const [expiresIn, setExpiresIn] = useState('1h');
  const [signedToken, setSignedToken] = useState('');
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  // Verify tab
  const [verifyAlgorithm, setVerifyAlgorithm] = useState<SignAlgorithm>('HS256');
  const [token, setToken] = useState('');
  const [verifyKey, setVerifyKey] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const isHmacSign = signAlgorithm.startsWith('HS');
  const isHmacVerify = verifyAlgorithm.startsWith('HS');

  const runSign = async () => {
    trackEvent('tool_run', { tool: 'jwt-sign-verify' });
    setSigning(true);
    setSignError(null);
    setSignedToken('');
    try {
      setSignedToken(
        await signJwt({
          algorithm: signAlgorithm,
          payloadJson,
          secretOrPrivateKey: signKey,
          expiresIn,
        }),
      );
    } catch (e) {
      setSignError(toolErrorText(e, s, s.signFailed));
    } finally {
      setSigning(false);
    }
  };

  const runVerify = async () => {
    trackEvent('tool_run', { tool: 'jwt-sign-verify' });
    setVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      setVerifyResult(
        await verifyJwt({ token, algorithm: verifyAlgorithm, secretOrPublicKey: verifyKey }),
      );
    } catch (e) {
      setVerifyError(toolErrorText(e, s, s.verifyFailed));
    } finally {
      setVerifying(false);
    }
  };

  const statusLabel: Record<VerifyResult['status'], string> = {
    valid: s.statusValid,
    invalidSignature: s.statusInvalidSignature,
    expired: s.statusExpired,
    notYetValid: s.statusNotYetValid,
    algRejected: s.statusAlgRejected,
    malformed: s.statusMalformed,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'sign' | 'verify')}>
          <TabsList>
            <TabsTrigger value="sign">{s.tabSign}</TabsTrigger>
            <TabsTrigger value="verify">{s.tabVerify}</TabsTrigger>
          </TabsList>

          <TabsContent value="sign" className="space-y-3">
            <SegmentedControl
              label={s.algorithmLabel}
              value={signAlgorithm}
              onChange={setSignAlgorithm}
              options={ALGO_OPTIONS}
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.payloadLabel}</span>
              <Textarea
                value={payloadJson}
                onChange={(e) => setPayloadJson(e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">
                {isHmacSign ? s.secretLabel : s.privateKeyLabel}
              </span>
              {isHmacSign ? (
                <Input
                  value={signKey}
                  onChange={(e) => setSignKey(e.target.value)}
                  className="font-mono"
                  aria-label={s.secretLabel}
                />
              ) : (
                <Textarea
                  value={signKey}
                  onChange={(e) => setSignKey(e.target.value)}
                  rows={6}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  className="font-mono text-xs"
                  aria-label={s.privateKeyLabel}
                />
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.expiresInLabel}</span>
              <Input
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                placeholder="1h"
                className="font-mono"
                aria-label={s.expiresInLabel}
              />
              <p className="mt-1 text-xs text-muted-foreground">{s.expiresInHint}</p>
            </div>

            <Button type="button" onClick={runSign} disabled={signing || !payloadJson || !signKey}>
              {signing ? s.signing : s.signButton}
            </Button>

            {signError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {signError}
              </output>
            )}

            {signedToken && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.signedTokenLabel}</span>
                  <CopyButton text={signedToken} />
                </div>
                <Textarea value={signedToken} readOnly rows={4} className="font-mono text-xs" />
              </div>
            )}

            <PrivacyNote message={s.privacySign} />
          </TabsContent>

          <TabsContent value="verify" className="space-y-3">
            <SegmentedControl
              label={s.algorithmLabel}
              value={verifyAlgorithm}
              onChange={setVerifyAlgorithm}
              options={ALGO_OPTIONS}
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.tokenLabel}</span>
              <Textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">
                {isHmacVerify ? s.secretLabel : s.publicKeyLabel}
              </span>
              {isHmacVerify ? (
                <Input
                  value={verifyKey}
                  onChange={(e) => setVerifyKey(e.target.value)}
                  className="font-mono"
                  aria-label={s.secretLabel}
                />
              ) : (
                <Textarea
                  value={verifyKey}
                  onChange={(e) => setVerifyKey(e.target.value)}
                  rows={6}
                  placeholder="-----BEGIN PUBLIC KEY-----"
                  className="font-mono text-xs"
                  aria-label={s.publicKeyLabel}
                />
              )}
            </div>

            <Button type="button" onClick={runVerify} disabled={verifying || !token || !verifyKey}>
              {verifying ? s.verifying : s.verifyButton}
            </Button>

            {verifyError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {verifyError}
              </output>
            )}

            {verifyResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[verifyResult.status]}>
                    {statusLabel[verifyResult.status]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{verifyResult.detail}</p>
                {verifyResult.header && (
                  <div>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                      {s.headerLabel}
                    </span>
                    <pre className="rounded-md border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(verifyResult.header, null, 2)}
                    </pre>
                  </div>
                )}
                {verifyResult.payload && (
                  <div>
                    <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                      {s.payloadOutLabel}
                    </span>
                    <pre className="rounded-md border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(verifyResult.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <PrivacyNote message={s.privacyVerify} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
