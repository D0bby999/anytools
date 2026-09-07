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
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import {
  type HmacAlgo,
  type KeyEncoding,
  type OutputEncoding,
  computeHmac,
  verifyHmac,
} from './logic';
import { STRINGS } from './strings';

const ALGOS: HmacAlgo[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

type Mode = 'generate' | 'verify';

export function HmacGeneratorUi() {
  const s = useLocalized(STRINGS);
  const [mode, setMode] = useState<Mode>('generate');

  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const [keyEncoding, setKeyEncoding] = useState<KeyEncoding>('text');
  const [algo, setAlgo] = useState<HmacAlgo>('SHA-256');
  const [outputEncoding, setOutputEncoding] = useState<OutputEncoding>('hex');

  const [result, setResult] = useState<string>('');
  const [computeError, setComputeError] = useState<string | null>(null);

  const [expected, setExpected] = useState('');
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (mode !== 'generate' || !message || !key) {
      setResult('');
      setComputeError(null);
      return;
    }
    let cancelled = false;
    computeHmac(message, key, keyEncoding, algo)
      .then((hmac) => {
        if (cancelled) return;
        setResult(outputEncoding === 'hex' ? hmac.hex : hmac.base64);
        setComputeError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setResult('');
        setComputeError(toolErrorText(e, s, s.generateFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, message, key, keyEncoding, algo, outputEncoding, s]);

  const runVerify = async () => {
    if (!message || !key || !expected) return;
    trackEvent('tool_run', { tool: 'hmac-generator' });
    setVerifying(true);
    setVerifyError(null);
    setVerdict(null);
    try {
      setVerdict(await verifyHmac(message, key, keyEncoding, algo, expected, outputEncoding));
    } catch (e) {
      setVerifyError(toolErrorText(e, s, s.verifyFailed));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            setVerdict(null);
            setVerifyError(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="generate">{s.tabGenerate}</TabsTrigger>
            <TabsTrigger value="verify">{s.tabVerify}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Message, key and algorithm are shared between Generate and Verify — verifying a
            signature uses the exact same inputs that would have produced it. */}

        <div>
          <span className="mb-1.5 block text-sm font-medium">{s.messageLabel}</span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={s.messagePlaceholder}
            rows={3}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-sm font-medium">{s.keyLabel}</span>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={s.keyPlaceholder}
              className="font-mono"
              aria-label={s.keyLabel}
            />
          </div>
          <SegmentedControl
            label={s.keyEncodingLabel}
            value={keyEncoding}
            onChange={setKeyEncoding}
            options={[
              { value: 'text', label: s.keyEncodingText },
              { value: 'hex', label: s.keyEncodingHex },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SegmentedControl
            label={s.algorithmLabel}
            value={algo}
            onChange={setAlgo}
            options={ALGOS.map((a) => ({ value: a, label: a }))}
          />
          <SegmentedControl
            label={s.outputEncodingLabel}
            value={outputEncoding}
            onChange={setOutputEncoding}
            options={[
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
        </div>

        {mode === 'generate' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{s.resultLabel}</span>
              {result && <CopyButton text={result} />}
            </div>
            {computeError ? (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {computeError}
              </output>
            ) : (
              <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                {result || <span className="italic text-muted-foreground">—</span>}
              </pre>
            )}
          </div>
        )}

        {mode === 'verify' && (
          <div className="space-y-3">
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.expectedLabel}</span>
              <Textarea
                value={expected}
                onChange={(e) => {
                  setExpected(e.target.value);
                  setVerdict(null);
                }}
                placeholder={s.expectedPlaceholder}
                rows={2}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={runVerify}
                disabled={!message || !key || !expected || verifying}
              >
                {verifying ? s.verifying : s.verifyButton}
              </Button>
              {verdict !== null && (
                <Badge
                  className={
                    verdict
                      ? 'border-0 bg-success/10 text-success'
                      : 'border-0 bg-destructive/10 text-destructive'
                  }
                >
                  {verdict ? s.match : s.noMatch}
                </Badge>
              )}
            </div>
            {verifyError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {verifyError}
              </output>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
