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
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type ArchiveSession, openArchive, repackAll } from './logic';
import { STRINGS } from './strings';

const ACCEPT =
  '.zip,.7z,.rar,.tar,.gz,.tgz,application/zip,application/x-7z-compressed,application/vnd.rar,application/x-tar,application/gzip';

const fmt = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

export function UnzipArchiveUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<ArchiveSession | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;
  // Closing a session terminates the libarchive worker, which is what releases the copy of the
  // archive sitting in the WASM heap. Leaving the page must not strand it.
  const openSession = useRef<ArchiveSession | null>(null);
  useEffect(() => {
    openSession.current = session;
  }, [session]);
  useEffect(
    () => () => {
      void openSession.current?.close();
    },
    [],
  );

  // Revoking inside a setState updater runs twice under StrictMode's double-invoke, and React
  // may call an updater at a moment of its choosing — neither is a place for a side effect.
  // The current URL is tracked here so revocation happens on the way to setState instead.
  const zipUrlRef = useRef<string | null>(null);
  const replaceZipUrl = (blob: Blob | null) => {
    objectUrls.revoke(zipUrlRef.current);
    const next = blob ? objectUrls.create(blob) : null;
    zipUrlRef.current = next;
    setZipUrl(next);
  };

  const reset = async () => {
    await openSession.current?.close();
    openSession.current = null;
    setSession(null);
    setError(null);
    setStatus(null);
    replaceZipUrl(null);
  };

  const open = async () => {
    if (!file) return;
    trackEvent('tool_run', { tool: 'unzip-archive' });
    setBusy(true);
    await reset();
    try {
      const opened = await openArchive(file, password.trim() || undefined);
      setSession(opened);
      openSession.current = opened;
      // The archive is unlocked; the session needs no further use of the password, so it stops
      // sitting in this component's state (and in the form field) for the rest of the visit.
      setPassword('');
    } catch (e) {
      setError(toolErrorText(e, s, s.readFailed));
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async (path: string) => {
    if (!session) return;
    setError(null);
    try {
      const blob = await session.extract(path);
      const url = objectUrls.create(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = path.split('/').pop() || 'file';
      a.click();
      // Revoking in the same tick cancels the download that click() just started. The hook
      // revokes everything on unmount anyway; this only keeps a long session from pinning
      // every file the user has already saved.
      setTimeout(() => objectUrls.revoke(url), 30_000);
    } catch (e) {
      setError(toolErrorText(e, s, s.extractFailed.replace('{path}', path)));
    }
  };

  const downloadAll = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await repackAll(session, (done, total) =>
        setStatus(s.extracting.replace('{done}', String(done)).replace('{total}', String(total))),
      );
      replaceZipUrl(blob);
      setStatus(null);
    } catch (e) {
      setStatus(null);
      setError(toolErrorText(e, s, s.repackFailed));
    } finally {
      setBusy(false);
    }
  };

  const total = session?.entries.reduce((n, e) => n + e.size, 0) ?? 0;

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
            void reset();
          }}
          accept={ACCEPT}
          multiple={false}
          label={s.archiveLabel}
        />

        <div className="space-y-1 text-sm">
          {/* htmlFor rather than wrapping: <Input> is a component, so the a11y rule cannot see
              the input inside it. */}
          <label htmlFor="unzip-password" className="block text-muted-foreground">
            {s.passwordLabel}
          </label>
          <Input
            id="unzip-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            placeholder={s.passwordPlaceholder}
          />
        </div>

        <button
          type="button"
          onClick={open}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.working : s.openArchive}
        </button>

        {status && <p className="text-sm text-muted-foreground">{status}</p>}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {session && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {s.summary
                .replace('{kind}', session.kind.toUpperCase())
                .replace('{n}', String(session.entries.length))
                .replace('{size}', fmt(total))
                .replace('{engine}', session.engine === 'jszip' ? 'JSZip' : 'libarchive (WASM)')}
            </p>

            {session.entries.length > 0 && (
              <button
                type="button"
                onClick={downloadAll}
                disabled={busy}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
              >
                {s.extractAll}
              </button>
            )}

            {zipUrl && (
              <a
                href={zipUrl}
                download={`${(file?.name ?? 'archive').replace(/\.[^.]+$/, '')}-extracted.zip`}
                className="ml-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.downloadZip}
              </a>
            )}

            <ul className="max-h-96 divide-y overflow-auto rounded-md border text-sm">
              {session.entries.map((entry) => (
                <li key={entry.path} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.path}</span>
                  <span className="shrink-0 text-muted-foreground">{fmt(entry.size)}</span>
                  <button
                    type="button"
                    onClick={() => downloadOne(entry.path)}
                    className="shrink-0 underline"
                  >
                    {ui.download}
                  </button>
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
