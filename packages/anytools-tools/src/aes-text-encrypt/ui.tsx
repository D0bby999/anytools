'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { decryptText, encryptText } from './logic';
import { STRINGS } from './strings';

type Mode = 'encrypt' | 'decrypt';

export function AesTextEncryptUi() {
  const s = useLocalized(STRINGS);
  const [mode, setMode] = useState<Mode>('encrypt');

  const [plaintext, setPlaintext] = useState('');
  const [encryptPassword, setEncryptPassword] = useState('');
  const [encrypted, setEncrypted] = useState('');
  const [encryptError, setEncryptError] = useState<string | null>(null);
  const [encrypting, setEncrypting] = useState(false);

  const [ciphertext, setCiphertext] = useState('');
  const [decryptPassword, setDecryptPassword] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  const runEncrypt = async () => {
    if (!plaintext) return;
    trackEvent('tool_run', { tool: 'aes-text-encrypt' });
    setEncrypting(true);
    setEncryptError(null);
    setEncrypted('');
    try {
      setEncrypted(await encryptText(plaintext, encryptPassword));
    } catch (e) {
      setEncryptError(toolErrorText(e, s, s.encryptFailed));
    } finally {
      setEncrypting(false);
    }
  };

  const runDecrypt = async () => {
    if (!ciphertext) return;
    trackEvent('tool_run', { tool: 'aes-text-encrypt' });
    setDecrypting(true);
    setDecryptError(null);
    setDecrypted('');
    try {
      setDecrypted(await decryptText(ciphertext, decryptPassword));
    } catch (e) {
      setDecryptError(toolErrorText(e, s, s.decryptFailed));
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="encrypt">{s.tabEncrypt}</TabsTrigger>
            <TabsTrigger value="decrypt">{s.tabDecrypt}</TabsTrigger>
          </TabsList>

          <TabsContent value="encrypt" className="space-y-3">
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.plaintextLabel}</span>
              <Textarea
                value={plaintext}
                onChange={(e) => setPlaintext(e.target.value)}
                placeholder={s.plaintextPlaceholder}
                rows={4}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.passwordLabel}</span>
              <Input
                type="password"
                value={encryptPassword}
                onChange={(e) => setEncryptPassword(e.target.value)}
                aria-label={s.passwordLabel}
                autoComplete="new-password"
                className="font-mono"
              />
            </div>
            <button
              type="button"
              onClick={runEncrypt}
              disabled={!plaintext || !encryptPassword || encrypting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {encrypting ? s.encrypting : s.encryptButton}
            </button>

            {encryptError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {encryptError}
              </output>
            )}

            {encrypted && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.encryptedLabel}</span>
                  <CopyButton text={encrypted} />
                </div>
                <Textarea value={encrypted} readOnly rows={4} className="font-mono text-xs" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="decrypt" className="space-y-3">
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.ciphertextLabel}</span>
              <Textarea
                value={ciphertext}
                onChange={(e) => setCiphertext(e.target.value)}
                placeholder={s.ciphertextPlaceholder}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.passwordLabel}</span>
              <Input
                type="password"
                value={decryptPassword}
                onChange={(e) => setDecryptPassword(e.target.value)}
                aria-label={s.passwordLabel}
                autoComplete="current-password"
                className="font-mono"
              />
            </div>
            <button
              type="button"
              onClick={runDecrypt}
              disabled={!ciphertext || !decryptPassword || decrypting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {decrypting ? s.decrypting : s.decryptButton}
            </button>

            {decryptError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {decryptError}
              </output>
            )}

            {decrypted && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.decryptedLabel}</span>
                  <CopyButton text={decrypted} />
                </div>
                <Textarea value={decrypted} readOnly rows={4} />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground">{s.formatNote}</p>
        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}
