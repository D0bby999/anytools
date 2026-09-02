'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { type MergeResult, mergePdfs } from './logic';

export function MergePdfUi() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Merging is not free on a large scan, so it runs on click rather than on every list
  // change the way the single-file image converter does.
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await mergePdfs(files);
      setResult(r);
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  // Any change to the inputs invalidates the previous output — keeping a stale download
  // button next to an edited list is how someone ships the wrong file.
  useEffect(() => {
    setResult(null);
    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setError(null);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Merge PDF</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
            setDownloadUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }}
          accept="application/pdf,.pdf"
          reorderable
          label="PDFs to merge — drag to reorder, or use the arrows. They are combined top to bottom."
        />

        <button
          type="button"
          onClick={run}
          disabled={files.length < 2 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Merging…' : `Merge ${files.length || ''} PDF${files.length === 1 ? '' : 's'}`}
        </button>

        {files.length === 1 && (
          <p className="text-sm text-muted-foreground">Add at least one more PDF to merge.</p>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div className="font-medium">{result.pages} pages</div>
              <ul className="mt-1 text-muted-foreground">
                {result.sources.map((s) => (
                  <li key={s.name}>
                    {s.name} — {s.pages} {s.pages === 1 ? 'page' : 'pages'}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={downloadUrl}
              download="merged.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download merged.pdf
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
