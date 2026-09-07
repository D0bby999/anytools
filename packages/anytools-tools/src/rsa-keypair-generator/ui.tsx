'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  SegmentedControl,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type KeyAlgorithmChoice,
  type KeyPairPem,
  type RsaKeySize,
  generateEd25519KeyPair,
  generateRsaKeyPair,
  isEd25519Supported,
} from './logic';
import { STRINGS } from './strings';

const KEY_SIZES: RsaKeySize[] = [2048, 3072, 4096];

export function RsaKeypairGeneratorUi() {
  const s = useLocalized(STRINGS);
  const objectUrls = useObjectUrls();
  const [ed25519Ok, setEd25519Ok] = useState(false);
  const [algorithm, setAlgorithm] = useState<KeyAlgorithmChoice>('RSASSA-PKCS1-v1_5');
  const [keySize, setKeySize] = useState<RsaKeySize>(2048);
  const [pair, setPair] = useState<KeyPairPem | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [privateUrl, setPrivateUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isEd25519Supported().then((ok) => {
      if (!cancelled) setEd25519Ok(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const algoOptions = [
    { value: 'RSASSA-PKCS1-v1_5' as const, label: s.algoRsaSign },
    { value: 'RSA-OAEP' as const, label: s.algoRsaEncrypt },
    ...(ed25519Ok ? [{ value: 'Ed25519' as const, label: s.algoEd25519 }] : []),
  ];

  const run = async () => {
    trackEvent('tool_run', { tool: 'rsa-keypair-generator' });
    setBusy(true);
    setError(null);
    try {
      const result =
        algorithm === 'Ed25519'
          ? await generateEd25519KeyPair()
          : await generateRsaKeyPair(algorithm, keySize);
      setPair(result);
      objectUrls.revokeAll();
      setPublicUrl(objectUrls.create(new Blob([result.publicKeyPem], { type: 'text/plain' })));
      setPrivateUrl(objectUrls.create(new Blob([result.privateKeyPem], { type: 'text/plain' })));
    } catch (e) {
      setError(toolErrorText(e, s, s.generateFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          label={s.algorithmLabel}
          value={algorithm}
          onChange={(v) => setAlgorithm(v)}
          options={algoOptions}
        />
        {!ed25519Ok && <p className="text-xs text-muted-foreground">{s.ed25519Unsupported}</p>}

        {algorithm !== 'Ed25519' && (
          <SegmentedControl
            label={s.keySizeLabel}
            value={String(keySize)}
            onChange={(v) => setKeySize(Number(v) as RsaKeySize)}
            options={KEY_SIZES.map((size) => ({ value: String(size), label: `${size}-bit` }))}
          />
        )}

        <Button type="button" onClick={run} disabled={busy}>
          {busy ? s.generating : s.generateButton}
        </Button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {pair && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.publicKeyLabel}</span>
                <div className="flex items-center gap-2">
                  <CopyButton text={pair.publicKeyPem} />
                  {publicUrl && (
                    <a
                      href={publicUrl}
                      download="public-key.pem"
                      className="text-xs font-medium text-primary underline underline-offset-2"
                    >
                      {s.downloadPublic}
                    </a>
                  )}
                </div>
              </div>
              <Textarea value={pair.publicKeyPem} readOnly rows={6} className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.privateKeyLabel}</span>
                <div className="flex items-center gap-2">
                  <CopyButton text={pair.privateKeyPem} />
                  {privateUrl && (
                    <a
                      href={privateUrl}
                      download="private-key.pem"
                      className="text-xs font-medium text-primary underline underline-offset-2"
                    >
                      {s.downloadPrivate}
                    </a>
                  )}
                </div>
              </div>
              <Textarea
                value={pair.privateKeyPem}
                readOnly
                rows={10}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}
