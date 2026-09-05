'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type MergeResult, mergePdfs } from './logic';
import { STRINGS } from './strings';

export function MergePdfUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
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
        if (prev) objectUrls.revoke(prev);
        return objectUrls.create(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
    }
  };

  // Invalidating the previous output when the file list changes is handled inline in the
  // dropzone's onChange below. An effect with `[]` deps used to sit here claiming to do it;
  // it ran once on mount against empty state and could never fire again — dead code carrying
  // a comment that asserted behaviour it did not have.

  const mergeLabel =
    files.length === 0
      ? s.mergeEmpty
      : files.length === 1
        ? s.mergeOne
        : s.mergeMany.replace('{n}', String(files.length));

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
            setResult(null);
            setError(null);
            setDownloadUrl((prev) => {
              if (prev) objectUrls.revoke(prev);
              return null;
            });
          }}
          accept="application/pdf,.pdf"
          reorderable
          label={s.dropLabel}
        />

        <button
          type="button"
          onClick={run}
          disabled={files.length < 2 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.merging : mergeLabel}
        </button>

        {files.length === 1 && <p className="text-sm text-muted-foreground">{s.addMore}</p>}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div className="font-medium">{s.totalPages.replace('{n}', String(result.pages))}</div>
              <ul className="mt-1 text-muted-foreground">
                {result.sources.map((src) => (
                  <li key={src.name}>
                    {src.name} —{' '}
                    {(src.pages === 1 ? s.pageCountOne : s.pageCountMany).replace(
                      '{n}',
                      String(src.pages),
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={downloadUrl}
              download="merged.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.download}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
