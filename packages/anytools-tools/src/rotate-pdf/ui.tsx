'use client';
import {
  Button,
  FilePipelineTemplate,
  Input,
  Label,
  MultiFileDropzone,
  PrivacyNote,
  RadioGroup,
  RadioGroupField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type RotateAngle, type RotateResult, readPageCount, rotatePdf } from './logic';
import { STRINGS } from './strings';

const ANGLES: RotateAngle[] = [90, 180, 270];

export function RotatePdfUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [angle, setAngle] = useState<RotateAngle>(90);
  const [allPages, setAllPages] = useState(true);
  const [range, setRange] = useState('');
  const [result, setResult] = useState<RotateResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(toolErrorText(e, errorStrings, s.couldNotReadPdf)));
    return () => {
      cancelled = true;
    };
  }, [file, errorStrings, s.couldNotReadPdf]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await rotatePdf(file, angle, allPages ? '' : range);
      setResult(r);
      setUrl((prev) => {
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

  const outName = file ? file.name.replace(/\.pdf$/i, '') : 'document';

  return (
    <FilePipelineTemplate
      title={s.title}
      dropzone={
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
            setUrl((prev) => {
              if (prev) objectUrls.revoke(prev);
              return null;
            });
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label={s.dropLabel}
        />
      }
      result={
        <>
          {pageCount !== null && (
            <p className="text-sm text-muted-foreground">
              {(pageCount === 1 ? s.pageCountOne : s.pageCountMany).replace(
                '{n}',
                String(pageCount),
              )}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rot-angle">{s.rotateBy}</Label>
            <Select value={String(angle)} onValueChange={(v) => setAngle(Number(v) as RotateAngle)}>
              <SelectTrigger id="rot-angle" className="md:w-48">
                <SelectValue>{angle}°</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ANGLES.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}°
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium">{s.whichPages}</span>
            <RadioGroup
              value={allPages ? 'all' : 'some'}
              onValueChange={(v) => setAllPages(v === 'all')}
              aria-label={s.whichPages}
            >
              <RadioGroupField value="all" label={s.everyPage} />
              <RadioGroupField value="some" label={s.onlyThese} />
            </RadioGroup>
            {!allPages && (
              <Input
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder={pageCount ? `1-${pageCount}` : '1-3, 7'}
                aria-label={s.onlyThese}
              />
            )}
          </div>

          <Button
            type="button"
            onClick={run}
            disabled={!file || busy || (!allPages && !range.trim())}
          >
            {busy ? s.rotating : s.rotate.replace('{angle}', String(angle))}
          </Button>

          {error && (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </output>
          )}

          {result && url && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted p-3 text-sm">
                {(result.pages === 1 ? s.rotatedOne : s.rotatedMany)
                  .replace('{n}', String(result.rotated))
                  .replace('{total}', String(result.pages))}
              </div>
              <Button asChild>
                <a href={url} download={`${outName}-rotated.pdf`}>
                  {s.download.replace('{name}', `${outName}-rotated.pdf`)}
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
