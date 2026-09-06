'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  SegmentedControl,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import {
  base64FromBytes,
  bytesFromBase64,
  bytesFromFile,
  bytesFromHex,
  formatBytes,
  hexFromBytes,
} from '../shared/binary-input';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { decodeMsgpack, encodeMsgpack } from './logic';
import { type MsgpackDecoderStrings, STRINGS } from './strings';

type Mode = 'decode' | 'encode';
type Encoding = 'hex' | 'base64';

function sizeLine(s: MsgpackDecoderStrings, inputBytes: number, outputBytes: number): string {
  const percent = inputBytes === 0 ? 0 : Math.round((1 - outputBytes / inputBytes) * 100);
  return s.sizeComparison
    .replace('{input}', formatBytes(inputBytes))
    .replace('{output}', formatBytes(outputBytes))
    .replace('{percent}', String(Math.abs(percent)))
    .replace('{direction}', percent >= 0 ? s.smaller : s.larger);
}

export function MsgpackDecoderUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const objectUrls = useObjectUrls();
  const [mode, setMode] = useState<Mode>('decode');
  const [encoding, setEncoding] = useState<Encoding>('hex');
  const [payloadText, setPayloadText] = useState('');
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [jsonText, setJsonText] = useState('{\n  "id": 42,\n  "name": "Ada"\n}');
  const [decodedJson, setDecodedJson] = useState<{ json: string; sizes: string } | null>(null);
  const [encoded, setEncoded] = useState<{ text: string; url: string; sizes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    try {
      setFileBytes(bytesFromFile(await file.arrayBuffer()));
      setPayloadText('');
      setError(null);
    } catch (e) {
      setError(toolErrorText(e, s, ui.invalidInput));
      setFileBytes(null);
    }
  };

  useEffect(() => {
    if (mode !== 'decode') return;
    if (fileBytes === null && payloadText.trim().length === 0) {
      setDecodedJson(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const bytes =
          fileBytes ??
          (encoding === 'hex' ? bytesFromHex(payloadText) : bytesFromBase64(payloadText));
        const result = await decodeMsgpack(bytes);
        if (cancelled) return;
        setDecodedJson({
          json: result.json,
          sizes: sizeLine(s, result.inputBytes, result.outputBytes),
        });
        setError(null);
        trackEvent('tool_run', { tool: 'msgpack-decoder' });
      } catch (e) {
        if (cancelled) return;
        setDecodedJson(null);
        setError(toolErrorText(e, s, ui.invalidInput));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, fileBytes, payloadText, encoding, s, ui.invalidInput]);

  useEffect(() => {
    if (mode !== 'encode' || jsonText.trim().length === 0) {
      setEncoded((prev) => {
        objectUrls.revoke(prev?.url);
        return null;
      });
      setError(null);
      return;
    }
    let cancelled = false;
    encodeMsgpack(jsonText)
      .then((result) => {
        if (cancelled) return;
        const text =
          encoding === 'hex' ? hexFromBytes(result.bytes) : base64FromBytes(result.bytes);
        const url = objectUrls.create(new Blob([result.bytes], { type: 'application/x-msgpack' }));
        setEncoded((prev) => {
          objectUrls.revoke(prev?.url);
          return { text, url, sizes: sizeLine(s, result.inputBytes, result.outputBytes) };
        });
        setError(null);
        trackEvent('tool_run', { tool: 'msgpack-decoder' });
      })
      .catch((e) => {
        if (cancelled) return;
        setEncoded((prev) => {
          objectUrls.revoke(prev?.url);
          return null;
        });
        setError(toolErrorText(e, s, ui.invalidInput));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, jsonText, encoding, s, ui.invalidInput, objectUrls]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'decode', label: s.modeDecode },
            { value: 'encode', label: s.modeEncode },
          ]}
        />
        <SegmentedControl
          value={encoding}
          onChange={setEncoding}
          label={s.encodingLabel}
          options={[
            { value: 'hex', label: s.hex },
            { value: 'base64', label: s.base64 },
          ]}
        />

        {mode === 'decode' ? (
          <div className="space-y-2">
            <span className="block text-sm font-medium">{s.payloadLabel}</span>
            <Textarea
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value);
                setFileBytes(null);
              }}
              placeholder={s.payloadPlaceholder}
              rows={4}
              className="font-mono text-sm"
              aria-label={s.payloadLabel}
            />
            <label className="block text-sm text-muted-foreground">
              {s.uploadFile}
              <input
                type="file"
                accept=".msgpack,application/x-msgpack,application/octet-stream"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="block w-full text-sm mt-1"
              />
            </label>
          </div>
        ) : (
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.jsonLabel}</span>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={s.jsonPlaceholder}
              rows={10}
              className="font-mono text-sm"
              aria-label={s.jsonLabel}
            />
          </div>
        )}

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {error}
          </p>
        ) : mode === 'decode' ? (
          decodedJson ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{decodedJson.sizes}</span>
                <CopyButton text={decodedJson.json} />
              </div>
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
                {decodedJson.json}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">{s.waitingDecode}</p>
          )
        ) : encoded ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{encoded.sizes}</span>
              <div className="flex gap-2">
                <CopyButton text={encoded.text} />
                <a
                  href={encoded.url}
                  download="data.msgpack"
                  className="text-sm underline text-primary"
                >
                  {s.downloadMsgpack}
                </a>
              </div>
            </div>
            <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
              {encoded.text}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">{s.waitingEncode}</p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
