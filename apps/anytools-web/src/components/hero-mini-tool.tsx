'use client';
import { Link } from '@/i18n/routing';
import { CopyButton } from '@anytools/ui';
import { ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

const SAMPLE = '{"name":"Alice","langs":["en","vi","es"],"active":true,"score":9.5}';

/**
 * Live hero demo backed by a real, browser-only JSON formatter (no fake output).
 * Parsing happens on-device via JSON.parse/stringify — nothing leaves the page,
 * which is the value prop the homepage is selling. Links out to the full tool.
 */
export function HeroMiniTool() {
  const t = useTranslations('landing');
  const [input, setInput] = useState(SAMPLE);

  const result = useMemo<{ ok: boolean; out: string; error?: string }>(() => {
    const trimmed = input.trim();
    if (!trimmed) return { ok: true, out: '' };
    try {
      return { ok: true, out: JSON.stringify(JSON.parse(trimmed), null, 2) };
    } catch (e) {
      return { ok: false, out: '', error: (e as Error).message };
    }
  }, [input]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Header — tool name + live validity status */}
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
            <span className="font-medium text-sm truncate">JSON Formatter</span>
          </div>
          {input.trim() &&
            (result.ok ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('heroToolValid')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t('heroToolInvalid')}
              </span>
            ))}
        </div>

        {/* Input */}
        <div className="p-4 border-b">
          <label
            htmlFor="hero-json-input"
            className="block text-xs uppercase tracking-wide text-muted-foreground mb-2"
          >
            {t('heroToolInput')}
          </label>
          <textarea
            id="hero-json-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            rows={3}
            aria-label="JSON input"
            className="w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Output */}
        <div className="p-4 bg-muted/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('heroToolOutput')}
            </span>
            {result.ok && result.out && <CopyButton text={result.out} size="sm" />}
          </div>
          <pre className="font-mono text-sm whitespace-pre-wrap break-all min-h-[5.5rem] max-h-44 overflow-auto">
            {result.ok ? (
              <span className="text-foreground">{result.out}</span>
            ) : (
              <span className="text-destructive">{result.error}</span>
            )}
          </pre>
        </div>

        {/* Footer — link to the full tool */}
        <Link
          href="/formatters/json-formatter"
          className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm font-medium text-muted-foreground hover:text-accent hover:bg-accent/5 transition-colors duration-150"
        >
          <span>{t('heroToolOpen')}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
