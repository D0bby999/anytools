'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  CheckboxField,
  FilePipelineTemplate,
  MultiFileDropzone,
  PrivacyNote,
  RadioGroup,
  RadioGroupField,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type LockPermissions,
  type LockResult,
  type PdfInspection,
  type UnlockResult,
  inspectLockedPdf,
  lockPdf,
  unlockPdf,
} from './logic';
import { STRINGS } from './strings';

const fieldClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Mode = 'lock' | 'unlock';

const PERMISSION_ROWS: Array<[keyof LockPermissions, keyof typeof STRINGS.en]> = [
  ['printing', 'permPrinting'],
  ['copying', 'permCopying'],
  ['modifying', 'permModifying'],
  ['annotating', 'permAnnotating'],
];

export function PdfPasswordUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const objectUrls = useObjectUrls();

  const [mode, setMode] = useState<Mode>('lock');
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;

  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [permissions, setPermissions] = useState<LockPermissions>({
    printing: true,
    copying: true,
    modifying: true,
    annotating: true,
  });

  const [password, setPassword] = useState('');
  // Set only once inspectLockedPdf finds form fields — the widget then waits for an explicit
  // "continue anyway" click before running the lossy copyPages step. Cleared by any input change.
  const [pendingInspection, setPendingInspection] = useState<PdfInspection | null>(null);

  const [lockResult, setLockResult] = useState<LockResult | null>(null);
  const [unlockResult, setUnlockResult] = useState<UnlockResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clearOutcome = () => {
    objectUrls.revoke(downloadUrl);
    setDownloadUrl(null);
    setLockResult(null);
    setUnlockResult(null);
    setError(null);
  };

  const clearAll = () => {
    clearOutcome();
    setPendingInspection(null);
  };

  const runLock = async () => {
    if (!file) return;
    setBusy(true);
    clearOutcome();
    trackEvent('tool_run', { tool: 'pdf-password' });
    try {
      const r = await lockPdf(file, { userPassword, ownerPassword, permissions });
      setLockResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
    } catch (e) {
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
    }
  };

  // Two-phase: first call inspects the file (needs the password to even open it) and, if it has
  // form fields, stops to show the warning instead of finishing. A second call — pendingInspection
  // now set — skips straight to the actual, lossy unlock.
  const runUnlock = async () => {
    if (!file) return;
    setBusy(true);
    clearOutcome();
    try {
      if (!pendingInspection) {
        const info = await inspectLockedPdf(file, password);
        if (info.fieldCount > 0) {
          setPendingInspection(info);
          setBusy(false);
          return;
        }
      }
      trackEvent('tool_run', { tool: 'pdf-password' });
      const r = await unlockPdf(file, password);
      setUnlockResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
      setPendingInspection(null);
    } catch (e) {
      setPendingInspection(null);
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
    }
  };

  const outName = file ? file.name.replace(/\.pdf$/i, '') : 'document';

  return (
    <FilePipelineTemplate
      title={s.title}
      dropzone={
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            clearAll();
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label={mode === 'lock' ? s.dropLabelLock : s.dropLabelUnlock}
        />
      }
      result={
        <>
          {mode === 'lock' ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">{s.userPasswordLabel}</span>
                  <input
                    type="password"
                    value={userPassword}
                    onChange={(e) => {
                      setUserPassword(e.target.value);
                      clearOutcome();
                    }}
                    className={fieldClass}
                    autoComplete="new-password"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">{s.ownerPasswordLabel}</span>
                  <input
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => {
                      setOwnerPassword(e.target.value);
                      clearOutcome();
                    }}
                    className={fieldClass}
                    autoComplete="new-password"
                  />
                  <span className="block text-xs text-muted-foreground">{s.ownerPasswordHint}</span>
                </label>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{s.permissionsLegend}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PERMISSION_ROWS.map(([key, labelKey]) => (
                    <CheckboxField
                      key={key}
                      label={s[labelKey]}
                      checked={permissions[key]}
                      onCheckedChange={(v) => {
                        setPermissions((p) => ({ ...p, [key]: v === true }));
                        clearOutcome();
                      }}
                    />
                  ))}
                </div>
              </fieldset>

              <Button
                type="button"
                onClick={runLock}
                disabled={!file || busy || !userPassword.trim()}
              >
                {busy ? s.locking : s.lockButton}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="space-y-1 text-sm">
                <span className="font-medium">{s.unlockPasswordLabel}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPendingInspection(null);
                    clearOutcome();
                  }}
                  className={fieldClass}
                  autoComplete="current-password"
                />
              </label>

              {pendingInspection ? (
                <output className="block space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  <p>
                    {(pendingInspection.fieldCount === 1
                      ? s.formWarningOne
                      : s.formWarningMany
                    ).replace('{n}', String(pendingInspection.fieldCount))}
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={runUnlock} disabled={busy}>
                      {s.continueAnyway}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingInspection(null)}
                    >
                      {s.cancel}
                    </Button>
                  </div>
                </output>
              ) : (
                <Button
                  type="button"
                  onClick={runUnlock}
                  disabled={!file || busy || !password.trim()}
                >
                  {busy ? s.unlocking : s.unlockButton}
                </Button>
              )}
            </div>
          )}

          {error && (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </output>
          )}

          {lockResult && downloadUrl && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted p-3 text-sm">
                {(lockResult.pages === 1 ? s.lockedOne : s.lockedMany).replace(
                  '{n}',
                  String(lockResult.pages),
                )}
              </div>
              <Button asChild>
                <a href={downloadUrl} download={`${outName}-locked.pdf`}>
                  {s.downloadLocked.replace('{name}', `${outName}-locked.pdf`)}
                </a>
              </Button>
            </div>
          )}

          {unlockResult && downloadUrl && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted p-3 text-sm">
                {(unlockResult.pages === 1 ? s.unlockedOne : s.unlockedMany).replace(
                  '{n}',
                  String(unlockResult.pages),
                )}
              </div>
              <Button asChild>
                <a href={downloadUrl} download={`${outName}-unlocked.pdf`}>
                  {s.downloadUnlocked.replace('{name}', `${outName}-unlocked.pdf`)}
                </a>
              </Button>
            </div>
          )}
        </>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
