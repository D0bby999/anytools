'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, Input, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type CompressionLevel, type CreateZipResult, createZip } from './logic';

const fmt = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function CreateZipUi() {
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
      setError(e instanceof Error ? e.message : 'Could not build the archive.');
    } finally {
      setBusy(false);
      setPercent(null);
    }
  };

  const saved = result ? result.inputBytes - result.outputBytes : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create ZIP</CardTitle>
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
          label="Files to put in the archive"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">
              Compression level: {level}
              {level === 0 ? ' — store, no compression' : ''}
            </span>
            <input
              type="range"
              min={0}
              max={9}
              step={1}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value) as CompressionLevel)}
              className="w-full"
              aria-label="Compression level"
            />
          </label>

          <div className="space-y-1 text-sm">
            {/* htmlFor rather than wrapping: <Input> is a component, and the a11y rule (rightly)
                cannot see an input inside it. */}
            <label htmlFor="create-zip-root" className="block text-muted-foreground">
              Folder inside the zip (optional)
            </label>
            <Input
              id="create-zip-root"
              value={rootFolder}
              onChange={(e) => setRootFolder(e.target.value)}
              placeholder="e.g. invoices"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Zipping…' : `Create .zip${files.length ? ` from ${files.length} files` : ''}`}
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
              {result.paths.length} files · {fmt(result.inputBytes)} in, {fmt(result.outputBytes)}{' '}
              out
              {result.inputBytes > 0 && (
                <> · {Math.round((saved / result.inputBytes) * 100)}% smaller</>
              )}
            </p>
            <a
              href={url}
              download={`${rootFolder.trim() || 'archive'}.zip`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download .zip
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
