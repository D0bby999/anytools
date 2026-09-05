'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type CompressionLevel, type CreateZipResult, createZip } from './logic';
import { STRINGS } from './strings';

const fmt = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function CreateZipUi() {
  const s = useLocalized(STRINGS);
  // Revokes every URL this component created when it unmounts; without it the finished
  // archive stays pinned for the life of the document.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [level, setLevel] = useState<CompressionLevel>(6);
  const [rootFolder, setRootFolder] = useState('');
  const [result, setResult] = useState<CreateZipResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setResult(null);
    setError(null);
    setUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
  };

  const run = async () => {
    if (files.length === 0) return;
    trackEvent('tool_run', { tool: 'create-zip' });
    setBusy(true);
    reset();
    setPercent(0);
    try {
      const r = await createZip(files, { level, rootFolder }, setPercent);
      setResult(r);
      setUrl(objectUrls.create(r.blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : s.buildFailed);
    } finally {
      setBusy(false);
      setPercent(null);
    }
  };

  const saved = result ? result.inputBytes - result.outputBytes : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept="*/*"
          multiple={true}
          label={s.filesLabel}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">
              {s.compressionLevel}: {level}
              {level === 0 ? ` — ${s.levelStore}` : ''}
            </span>
            <input
              type="range"
              min={0}
              max={9}
              step={1}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value) as CompressionLevel)}
              className="w-full"
              aria-label={s.compressionLevel}
            />
          </label>

          <div className="space-y-1 text-sm">
            {/* htmlFor rather than wrapping: <Input> is a component, and the a11y rule (rightly)
                cannot see an input inside it. */}
            <label htmlFor="create-zip-root" className="block text-muted-foreground">
              {s.folderLabel}
            </label>
            <Input
              id="create-zip-root"
              value={rootFolder}
              onChange={(e) => setRootFolder(e.target.value)}
              placeholder={s.folderPlaceholder}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? s.zipping
            : files.length
              ? s.createZipFrom.replace('{n}', String(files.length))
              : s.createZip}
        </button>

        {percent !== null && <p className="text-sm text-muted-foreground">{percent}%</p>}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && url && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {s.summary
                .replace('{n}', String(result.paths.length))
                .replace('{in}', fmt(result.inputBytes))
                .replace('{out}', fmt(result.outputBytes))}
              {result.inputBytes > 0 && (
                <>
                  {' · '}
                  {s.smaller.replace('{p}', String(Math.round((saved / result.inputBytes) * 100)))}
                </>
              )}
            </p>
            <a
              href={url}
              download={`${rootFolder.trim() || 'archive'}.zip`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.downloadZip}
            </a>
            <ul className="max-h-64 space-y-1 overflow-auto rounded-md border p-2 text-sm">
              {result.paths.map((p) => (
                <li key={p} className="truncate font-mono text-xs">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
