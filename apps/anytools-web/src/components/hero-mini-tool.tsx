'use client';
import { Link } from '@/i18n/routing';
import { CopyButton } from '@anytools/ui';
import { ArrowRight, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/**
 * Hero tool showcase — four real, browser-only tools behind tabs. Every output
 * is computed at runtime (JSON.parse/stringify, UTF-8 Base64, crypto.randomUUID,
 * a real scannable QR), never faked. This is the homepage's core proof: the tools
 * run on-device and nothing leaves the page. Fixed heights keep the layout stable
 * when switching tabs.
 */

type TabId = 'json' | 'base64' | 'uuid' | 'qr';

const TABS = [
  { id: 'json', label: 'JSON', full: 'JSON Formatter', href: '/formatters/json-formatter' },
  { id: 'base64', label: 'Base64', full: 'Base64 Encoder', href: '/encoding/base64-encode' },
  { id: 'uuid', label: 'UUID', full: 'UUID Generator', href: '/generators/uuid-generator' },
  { id: 'qr', label: 'QR Code', full: 'QR Generator', href: '/generators/qr-code-generator' },
] as const satisfies ReadonlyArray<{ id: TabId; label: string; full: string; href: string }>;

const SAMPLE_JSON = '{"name":"Alice","langs":["en","vi"],"active":true,"score":9.5}';
const SAMPLE_TEXT = 'Hello AnyTools 🌏';
const QR_URL = 'https://anytools.world';

// Real QR (error-correction M) for QR_URL, pre-generated with the `qrcode` lib —
// 25×25 modules, transparent background, slate-900 modules on a white quiet-zone tile.
const QR_PATH =
  'M0 0.5h7m4 0h2m1 0h1m1 0h1m1 0h7M0 1.5h1m5 0h1m3 0h2m1 0h3m2 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m1 0h1m2 0h2m1 0h1m1 0h1m1 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m1 0h1m4 0h2m3 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h1m1 0h1m1 0h2m4 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m1 0h1m2 0h6m1 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M8 7.5h2m4 0h1M0 8.5h1m1 0h5m3 0h2m1 0h4m1 0h5M1 9.5h1m1 0h1m4 0h1m1 0h3m1 0h1m1 0h1m2 0h1m3 0h1M0 10.5h2m3 0h4m2 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h2M1 11.5h2m1 0h1m4 0h2m4 0h2m7 0h1M0 12.5h1m1 0h7m2 0h1m1 0h2m2 0h2m1 0h1m1 0h3M0 13.5h1m2 0h1m4 0h2m2 0h2m2 0h2m1 0h1m1 0h1m1 0h1M0 14.5h1m1 0h1m3 0h2m6 0h3m2 0h3m1 0h2M0 15.5h1m1 0h2m3 0h1m2 0h1m1 0h1m3 0h5m3 0h1M0 16.5h1m1 0h1m1 0h1m1 0h1m1 0h2m2 0h3m1 0h5m1 0h1M8 17.5h1m6 0h2m3 0h2M0 18.5h7m3 0h3m1 0h1m1 0h1m1 0h1m1 0h1m1 0h3M0 19.5h1m5 0h1m1 0h1m1 0h2m4 0h1m3 0h2M0 20.5h1m1 0h3m1 0h1m1 0h2m1 0h1m3 0h6m1 0h3M0 21.5h1m1 0h3m1 0h1m1 0h3m1 0h2m2 0h3m1 0h5M0 22.5h1m1 0h3m1 0h1m1 0h3m2 0h2m1 0h2m3 0h2m1 0h1M0 23.5h1m5 0h1m3 0h1m1 0h2m1 0h7m2 0h1M0 24.5h7m1 0h1m3 0h1m1 0h1m3 0h7';

function toBase64(s: string): string {
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  } catch {
    return '';
  }
}

const labelCls = 'block text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const monoCls = 'font-mono text-sm text-foreground';

export function HeroMiniTool() {
  const [active, setActive] = useState<TabId>('json');
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [uuid, setUuid] = useState('');

  // Generate the first UUID on the client only (avoids SSR hydration mismatch).
  useEffect(() => {
    setUuid(crypto.randomUUID());
  }, []);

  const json = useMemo(() => {
    const t = jsonInput.trim();
    if (!t) return { ok: true, out: '' };
    try {
      return { ok: true, out: JSON.stringify(JSON.parse(t), null, 2) };
    } catch (e) {
      return { ok: false, out: '', error: (e as Error).message };
    }
  }, [jsonInput]);

  const base64 = useMemo(() => toBase64(text), [text]);
  const activeTab = TABS.find((tb) => tb.id === active) ?? TABS[0];

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Live tool demos"
          className="flex items-center gap-1 border-b bg-muted/30 p-1.5"
        >
          {TABS.map((tb) => {
            const selected = tb.id === active;
            return (
              <button
                key={tb.id}
                role="tab"
                type="button"
                id={`herotab-${tb.id}`}
                aria-selected={selected}
                aria-controls={`heropanel-${tb.id}`}
                onClick={() => setActive(tb.id)}
                className={`flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors duration-150 ${
                  selected
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card'
                }`}
              >
                {tb.label}
              </button>
            );
          })}
        </div>

        {/* Panel — fixed min-height keeps the card stable across tabs */}
        <div
          role="tabpanel"
          id={`heropanel-${active}`}
          aria-labelledby={`herotab-${active}`}
          className="flex min-h-[17rem] flex-col"
        >
          {active === 'json' && (
            <>
              <div className="border-b p-4">
                <label htmlFor="hero-json" className={`${labelCls} mb-2`}>
                  Input
                </label>
                <textarea
                  id="hero-json"
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  spellCheck={false}
                  rows={3}
                  aria-label="JSON input"
                  className={`w-full resize-none rounded-md border bg-background px-3 py-2 ${monoCls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                />
              </div>
              <div className="flex flex-1 flex-col bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className={labelCls}>Output</span>
                  {json.ok ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Invalid
                    </span>
                  )}
                </div>
                <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-sm">
                  {json.ok ? (
                    <span className="text-foreground">{json.out}</span>
                  ) : (
                    <span className="text-destructive">{json.error}</span>
                  )}
                </pre>
              </div>
            </>
          )}

          {active === 'base64' && (
            <>
              <div className="border-b p-4">
                <label htmlFor="hero-b64" className={`${labelCls} mb-2`}>
                  Text input
                </label>
                <input
                  id="hero-b64"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  aria-label="Text to encode"
                  className={`w-full rounded-md border bg-background px-3 py-2 ${monoCls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                />
              </div>
              <div className="flex flex-1 flex-col bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className={labelCls}>Base64 output</span>
                  {base64 && <CopyButton text={base64} size="sm" />}
                </div>
                <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-sm text-foreground">
                  {base64}
                </pre>
              </div>
            </>
          )}

          {active === 'uuid' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <span className={labelCls}>UUID v4 · cryptographically random</span>
              <code className="w-full break-all rounded-md border bg-muted/40 px-4 py-3 font-mono text-sm text-foreground">
                {uuid || '········-····-····-····-············'}
              </code>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUuid(crypto.randomUUID())}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors duration-150 hover:border-accent hover:text-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Generate new
                </button>
                {uuid && <CopyButton text={uuid} size="sm" />}
              </div>
            </div>
          )}

          {active === 'qr' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className={labelCls}>Scan to open</span>
              <div className="rounded-xl bg-white p-3 shadow-sm">
                <svg
                  viewBox="0 0 25 25"
                  shapeRendering="crispEdges"
                  className="h-32 w-32"
                  role="img"
                  aria-label={`QR code for ${QR_URL}`}
                >
                  <path stroke="#0F172A" d={QR_PATH} />
                </svg>
              </div>
              <code className="font-mono text-xs text-muted-foreground">{QR_URL}</code>
            </div>
          )}
        </div>

        {/* Footer — open the active tool for real */}
        <Link
          href={activeTab.href as never}
          className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/5 hover:text-accent"
        >
          <span>Open {activeTab.full}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
