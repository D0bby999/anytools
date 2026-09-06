'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  SegmentedControl,
  TableResult,
  Textarea,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  type Encoder,
  type EncodingId,
  countTokens,
  loadEncoder,
  modelsForEncoding,
} from './logic';
import { STRINGS } from './strings';

export function TokenCounterUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [text, setText] = useState('');
  const [encoding, setEncoding] = useState<EncodingId>('o200k_base');
  const [encoder, setEncoder] = useState<Encoder | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // The rank table (1-2 MB) loads lazily per encoding and is cached by loadEncoder itself, so
  // switching back to a previously-used encoding here resolves instantly on the next effect run.
  useEffect(() => {
    let cancelled = false;
    setEncoder(null);
    setLoadFailed(false);
    loadEncoder(encoding)
      .then((enc) => {
        if (!cancelled) setEncoder(enc);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [encoding]);

  // Keeps keystrokes responsive: encoding runs a full BPE pass over the text on every change,
  // which the input itself should never wait on.
  const deferredText = useDeferredValue(text);
  const counts = useMemo(
    () => (encoder ? countTokens(encoder, deferredText) : null),
    [encoder, deferredText],
  );

  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          label={s.encodingLabel}
          value={encoding}
          onChange={setEncoding}
          options={[
            { value: 'o200k_base', label: s.encodingO200k },
            { value: 'cl100k_base', label: s.encodingCl100k },
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {s.inputLabel}
            </span>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.placeholder}
              className="min-h-[260px] font-mono text-sm"
              aria-label={s.inputLabel}
            />
          </div>
          <div className="lg:col-span-2 space-y-3 lg:sticky lg:top-20 lg:self-start">
            {loadFailed ? (
              <p className="text-sm text-destructive">{s.loadFailed}</p>
            ) : !counts ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {s.loadingRanks}
              </p>
            ) : (
              <TableResult
                rows={[
                  { label: s.tokens, value: fmt(counts.tokens), emphasis: true },
                  { label: s.characters, value: fmt(counts.characters) },
                  { label: s.words, value: fmt(counts.words) },
                ]}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {s.usedBy}: {modelsForEncoding(encoding).join(', ')}
            </p>
            <p className="text-xs text-muted-foreground">{s.note}</p>
          </div>
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
