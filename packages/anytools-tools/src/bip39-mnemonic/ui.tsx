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
  WORD_COUNTS,
  type WordCount,
  entropyHexToMnemonicPhrase,
  generateMnemonicPhrase,
  isValidMnemonic,
  mnemonicToEntropyHex,
  mnemonicToSeedHex,
} from './logic';
import { STRINGS } from './strings';

const WORD_COUNT_OPTIONS = WORD_COUNTS.map((n) => ({ value: String(n), label: String(n) }));

/** The persistent risk banner every tab shares — real-money mistakes here are irreversible. */
function WarningBanner({ text }: { text: string }) {
  return (
    <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
      {text}
    </output>
  );
}

export function Bip39MnemonicUi() {
  const s = useLocalized(STRINGS);
  const [tab, setTab] = useState<'generate' | 'validate' | 'convert' | 'seed'>('generate');

  const [wordCount, setWordCount] = useState<WordCount>(12);
  const [phrase, setPhrase] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [checkInput, setCheckInput] = useState('');
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [m2eInput, setM2eInput] = useState('');
  const [m2eOutput, setM2eOutput] = useState('');
  const [m2eError, setM2eError] = useState<string | null>(null);
  const [e2mInput, setE2mInput] = useState('');
  const [e2mOutput, setE2mOutput] = useState('');
  const [e2mError, setE2mError] = useState<string | null>(null);

  const [seedMnemonic, setSeedMnemonic] = useState('');
  const [seedPassphrase, setSeedPassphrase] = useState('');
  const [seedOutput, setSeedOutput] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);

  const runGenerate = async () => {
    trackEvent('tool_run', { tool: 'bip39-mnemonic' });
    setGenerating(true);
    setGenerateError(null);
    try {
      setPhrase(await generateMnemonicPhrase(wordCount));
    } catch (e) {
      setGenerateError(toolErrorText(e, s, s.generateFailed));
    } finally {
      setGenerating(false);
    }
  };

  const runCheck = async () => {
    trackEvent('tool_run', { tool: 'bip39-mnemonic' });
    setChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      setCheckResult(await isValidMnemonic(checkInput));
    } catch (e) {
      setCheckError(toolErrorText(e, s, s.validateFailed));
    } finally {
      setChecking(false);
    }
  };

  const runMnemonicToEntropy = async () => {
    setM2eError(null);
    setM2eOutput('');
    try {
      setM2eOutput(await mnemonicToEntropyHex(m2eInput));
    } catch (e) {
      setM2eError(toolErrorText(e, s, s.convertFailed));
    }
  };

  const runEntropyToMnemonic = async () => {
    setE2mError(null);
    setE2mOutput('');
    try {
      setE2mOutput(await entropyHexToMnemonicPhrase(e2mInput));
    } catch (e) {
      setE2mError(toolErrorText(e, s, s.convertFailed));
    }
  };

  const runDeriveSeed = async () => {
    trackEvent('tool_run', { tool: 'bip39-mnemonic' });
    setDeriving(true);
    setSeedError(null);
    setSeedOutput('');
    try {
      setSeedOutput(await mnemonicToSeedHex(seedMnemonic, seedPassphrase));
    } catch (e) {
      setSeedError(toolErrorText(e, s, s.seedFailed));
    } finally {
      setDeriving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <WarningBanner text={s.warningBanner} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="generate">{s.tabGenerate}</TabsTrigger>
            <TabsTrigger value="validate">{s.tabValidate}</TabsTrigger>
            <TabsTrigger value="convert">{s.tabConvert}</TabsTrigger>
            <TabsTrigger value="seed">{s.tabSeed}</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-3">
            <SegmentedControl
              label={s.wordCountLabel}
              value={String(wordCount)}
              onChange={(v) => setWordCount(Number(v) as WordCount)}
              options={WORD_COUNT_OPTIONS}
            />
            <Button type="button" onClick={runGenerate} disabled={generating}>
              {generating ? s.generating : s.generateButton}
            </Button>
            {generateError && <ErrorBox text={generateError} />}
            {phrase && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.generatedPhraseLabel}</span>
                  <CopyButton text={phrase} />
                </div>
                <Textarea value={phrase} readOnly rows={3} className="font-mono text-sm" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="validate" className="space-y-3">
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.validateLabel}</span>
              <Textarea
                value={checkInput}
                onChange={(e) => setCheckInput(e.target.value)}
                rows={3}
                className="font-mono text-sm"
              />
            </div>
            <Button type="button" onClick={runCheck} disabled={checking || !checkInput.trim()}>
              {s.validateButton}
            </Button>
            {checkError && <ErrorBox text={checkError} />}
            {checkResult !== null && (
              <Badge variant={checkResult ? 'default' : 'destructive'}>
                {checkResult ? s.validResult : s.invalidResult}
              </Badge>
            )}
          </TabsContent>

          <TabsContent value="convert" className="space-y-5">
            <div className="space-y-2">
              <span className="block text-sm font-medium">{s.mnemonicToEntropyTitle}</span>
              <Textarea
                value={m2eInput}
                onChange={(e) => setM2eInput(e.target.value)}
                placeholder={s.mnemonicInputLabel}
                rows={2}
                className="font-mono text-sm"
              />
              <Button
                size="sm"
                type="button"
                onClick={runMnemonicToEntropy}
                disabled={!m2eInput.trim()}
              >
                {s.convertButton}
              </Button>
              {m2eError && <ErrorBox text={m2eError} />}
              {m2eOutput && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs break-all">
                    {m2eOutput}
                  </code>
                  <CopyButton text={m2eOutput} />
                </div>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <span className="block text-sm font-medium">{s.entropyToMnemonicTitle}</span>
              <Input
                value={e2mInput}
                onChange={(e) => setE2mInput(e.target.value)}
                placeholder={s.entropyInputLabel}
                className="font-mono text-sm"
              />
              <Button
                size="sm"
                type="button"
                onClick={runEntropyToMnemonic}
                disabled={!e2mInput.trim()}
              >
                {s.convertButton}
              </Button>
              {e2mError && <ErrorBox text={e2mError} />}
              {e2mOutput && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs break-all">
                    {e2mOutput}
                  </code>
                  <CopyButton text={e2mOutput} />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="seed" className="space-y-3">
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.seedMnemonicLabel}</span>
              <Textarea
                value={seedMnemonic}
                onChange={(e) => setSeedMnemonic(e.target.value)}
                rows={3}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.seedPassphraseLabel}</span>
              <Input
                type="text"
                value={seedPassphrase}
                onChange={(e) => setSeedPassphrase(e.target.value)}
                className="font-mono"
              />
              <p className="mt-1 text-xs text-muted-foreground">{s.seedPassphraseHint}</p>
            </div>
            <Button
              type="button"
              onClick={runDeriveSeed}
              disabled={deriving || !seedMnemonic.trim()}
            >
              {deriving ? s.generating : s.seedButton}
            </Button>
            {seedError && <ErrorBox text={seedError} />}
            {seedOutput && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.seedOutputLabel}</span>
                  <CopyButton text={seedOutput} />
                </div>
                <Textarea value={seedOutput} readOnly rows={3} className="font-mono text-xs" />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <PrivacyNote message={s.privacy} />
      </CardContent>
    </Card>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {text}
    </output>
  );
}
