'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import {
  type KeyUsageId,
  type X509ParsedCert,
  parseCertificateFile,
  parseCertificateText,
} from './logic';
import { STRINGS } from './strings';

const EXPIRING_SOON_DAYS = 30;

export function X509CertificateDecoderUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [pemText, setPemText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [certs, setCerts] = useState<X509ParsedCert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const file = files[0];
    if (!file && !pemText.trim()) return;
    trackEvent('tool_run', { tool: 'x509-certificate-decoder' });
    setBusy(true);
    setError(null);
    setCerts(null);
    try {
      setCerts(file ? await parseCertificateFile(file) : await parseCertificateText(pemText));
    } catch (e) {
      setError(toolErrorText(e, s, s.decodeFailed));
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
        <div>
          <span className="mb-1.5 block text-sm font-medium">{s.pasteLabel}</span>
          <Textarea
            value={pemText}
            onChange={(e) => {
              setPemText(e.target.value);
              setFiles([]);
            }}
            placeholder={s.pastePlaceholder}
            rows={6}
            className="font-mono text-xs"
          />
        </div>

        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            if (f.length > 0) setPemText('');
          }}
          accept=".cer,.crt,.der,.pem,application/x-x509-ca-cert"
          multiple={false}
          label={s.uploadLabel}
        />

        <button
          type="button"
          onClick={run}
          disabled={busy || (!files[0] && !pemText.trim())}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.decoding : s.decodeButton}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {certs?.map((cert, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: certs are re-derived wholesale each run, never reordered in place
          <CertCard key={i} cert={cert} index={i} total={certs.length} locale={locale} />
        ))}

        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}

function CertCard({
  cert,
  index,
  total,
  locale,
}: {
  cert: X509ParsedCert;
  index: number;
  total: number;
  locale: string;
}) {
  const s = useLocalized(STRINGS);
  const dyn = s as unknown as Record<string, string>;
  const publicKeyText =
    cert.publicKey.algorithm === 'RSA' && cert.publicKey.keySize
      ? s.publicKeyRsa
          .replace('{algorithm}', cert.publicKey.algorithm)
          .replace('{size}', String(cert.publicKey.keySize))
      : cert.publicKey.algorithm === 'EC' && cert.publicKey.curve
        ? s.publicKeyEc
            .replace('{algorithm}', cert.publicKey.algorithm)
            .replace('{curve}', cert.publicKey.curve)
        : cert.publicKey.algorithm;

  const expiringSoon =
    !cert.isExpired && !cert.isNotYetValid && cert.daysRemaining <= EXPIRING_SOON_DAYS;

  return (
    <div className="space-y-3 rounded-md border p-4">
      {total > 1 && (
        <p className="text-xs font-medium text-muted-foreground">
          {s.certificateN.replace('{n}', String(index + 1)).replace('{total}', String(total))}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {cert.isSelfSigned && <Badge variant="secondary">{s.badgeSelfSigned}</Badge>}
        {cert.isExpired && <Badge variant="destructive">{s.badgeExpired}</Badge>}
        {cert.isNotYetValid && <Badge variant="destructive">{s.badgeNotYetValid}</Badge>}
        {expiringSoon && <Badge variant="destructive">{s.badgeExpiringSoon}</Badge>}
      </div>

      <Field label={s.subject} value={cert.subject} copyable />
      <Field label={s.issuer} value={cert.issuer} copyable />
      <Field label={s.serialNumber} value={cert.serialNumber} copyable mono />
      <Field label={s.validFrom} value={cert.notBefore.toLocaleString(locale)} />
      <Field
        label={s.validTo}
        value={`${cert.notAfter.toLocaleString(locale)} — ${
          cert.isExpired
            ? s.daysExpiredAgo.replace('{n}', String(Math.abs(cert.daysRemaining)))
            : s.daysRemaining.replace('{n}', String(cert.daysRemaining))
        }`}
      />
      <Field label={s.signatureAlgorithm} value={cert.signatureAlgorithm} />
      <Field label={s.publicKey} value={publicKeyText} />

      {cert.san.length > 0 && (
        <Field
          label={s.subjectAltName}
          value={cert.san.map((e) => `${e.type}:${e.value}`).join(', ')}
        />
      )}
      {cert.keyUsageIds.length > 0 && (
        <Field
          label={s.keyUsage}
          value={cert.keyUsageIds.map((id: KeyUsageId) => dyn[`ku_${id}`] ?? id).join(', ')}
        />
      )}
      {cert.extendedKeyUsageIds.length > 0 && (
        <Field
          label={s.extendedKeyUsage}
          value={cert.extendedKeyUsageIds.map((id) => dyn[`eku_${id}`] ?? id).join(', ')}
        />
      )}
      {cert.basicConstraints && (
        <Field
          label={s.basicConstraints}
          value={`${s.isCa.replace('{value}', cert.basicConstraints.isCa ? s.yes : s.no)}${
            cert.basicConstraints.pathLengthConstraint !== undefined
              ? s.pathLength.replace('{n}', String(cert.basicConstraints.pathLengthConstraint))
              : ''
          }`}
        />
      )}
      <Field label={s.fingerprintSha256} value={cert.fingerprintSha256} copyable mono />
      <Field label={s.fingerprintSha1} value={cert.fingerprintSha1} copyable mono />
    </div>
  );
}

function Field({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
        {copyable && <CopyButton text={value} />}
      </div>
    </div>
  );
}
