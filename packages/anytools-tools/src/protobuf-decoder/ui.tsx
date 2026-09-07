'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { bytesFromBase64, bytesFromHex } from '../shared/binary-input';
import { ToolError, toolErrorText } from '../shared/tool-error';
import { type DecodedField, decodeWireFormat, decodeWithSchema, listMessageTypes } from './logic';
import { type ProtobufDecoderStrings, STRINGS } from './strings';

type Mode = 'schema' | 'blind';
type Encoding = 'hex' | 'base64';

function parsePayload(text: string, encoding: Encoding): Uint8Array {
  return encoding === 'hex' ? bytesFromHex(text) : bytesFromBase64(text);
}

function WireFieldRow({ field, s }: { field: DecodedField; s: ProtobufDecoderStrings }) {
  return (
    <li className="p-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono font-semibold">
          {s.fieldLabel.replace('{n}', String(field.fieldNumber))}
        </span>
        <span className="text-xs text-muted-foreground">
          {field.wireTypeName} · {field.byteLength}B
        </span>
      </div>
      <div className="mt-1 space-y-0.5 font-mono text-xs">
        {field.guesses.map((g) => (
          <div key={g.label} className="break-all">
            <span className="text-muted-foreground">{g.label}: </span>
            {g.value}
          </div>
        ))}
        {field.nested && <div className="text-muted-foreground italic">{s.nestedGuess}</div>}
      </div>
      {field.nested && (
        <ul className="mt-2 ml-3 border-l pl-3 space-y-2">
          {field.nested.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: guesses are recomputed on every decode, no stable id
            <WireFieldRow key={i} field={f} s={s} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProtobufDecoderUi() {
  const s = useLocalized(STRINGS);
  const [mode, setMode] = useState<Mode>('blind');
  const [payloadText, setPayloadText] = useState('');
  const [encoding, setEncoding] = useState<Encoding>('hex');
  const [protoText, setProtoText] = useState('');
  const [messageTypes, setMessageTypes] = useState<string[]>([]);
  const [messageType, setMessageType] = useState('');
  const [blindResult, setBlindResult] = useState<DecodedField[] | null>(null);
  const [schemaResult, setSchemaResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the message-type dropdown in sync with whatever the pasted .proto currently declares.
  useEffect(() => {
    if (mode !== 'schema' || protoText.trim().length === 0) {
      setMessageTypes([]);
      return;
    }
    let cancelled = false;
    listMessageTypes(protoText)
      .then((names) => {
        if (cancelled) return;
        setMessageTypes(names);
        setMessageType((prev) => (names.includes(prev) ? prev : (names[0] ?? '')));
      })
      .catch(() => {
        if (!cancelled) setMessageTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, protoText]);

  useEffect(() => {
    if (payloadText.trim().length === 0) {
      setBlindResult(null);
      setSchemaResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const bytes = parsePayload(payloadText, encoding);
        if (mode === 'blind') {
          const fields = decodeWireFormat(bytes);
          if (cancelled) return;
          setBlindResult(fields);
          setSchemaResult(null);
        } else {
          if (!messageType) {
            if (!cancelled) {
              setBlindResult(null);
              setSchemaResult(null);
            }
            return;
          }
          const obj = await decodeWithSchema(protoText, bytes, messageType);
          if (cancelled) return;
          setSchemaResult(obj);
          setBlindResult(null);
        }
        setError(null);
        trackEvent('tool_run', { tool: 'protobuf-decoder' });
      } catch (e) {
        if (cancelled) return;
        setBlindResult(null);
        setSchemaResult(null);
        setError(
          e instanceof ToolError
            ? toolErrorText(e, s, e.message)
            : toolErrorText(e, s, 'Decode failed'),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [payloadText, encoding, mode, protoText, messageType, s]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="blind">{s.modeBlind}</TabsTrigger>
            <TabsTrigger value="schema">{s.modeSchema}</TabsTrigger>
          </TabsList>
          <TabsContent value="schema" className="space-y-3">
            <div>
              <span className="block text-sm font-medium mb-1.5">{s.protoLabel}</span>
              <Textarea
                value={protoText}
                onChange={(e) => setProtoText(e.target.value)}
                placeholder={s.protoPlaceholder}
                rows={8}
                className="font-mono text-sm"
                aria-label={s.protoLabel}
              />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1.5">{s.messageTypeLabel}</span>
              {messageTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">{s.noTypesFound}</p>
              ) : (
                <Select value={messageType} onValueChange={setMessageType}>
                  <SelectTrigger aria-label={s.messageTypeLabel} className="font-mono">
                    <SelectValue>{messageType}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {messageTypes.map((name) => (
                      <SelectItem key={name} value={name} className="font-mono">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </TabsContent>
          <TabsContent value="blind">
            <p className="text-sm text-muted-foreground">{s.blindNote}</p>
          </TabsContent>
        </Tabs>

        <SegmentedControl
          value={encoding}
          onChange={setEncoding}
          label={s.encodingLabel}
          options={[
            { value: 'hex', label: s.hex },
            { value: 'base64', label: s.base64 },
          ]}
        />
        <div>
          <span className="block text-sm font-medium mb-1.5">{s.payloadLabel}</span>
          <Textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            placeholder={s.payloadPlaceholder}
            rows={4}
            className="font-mono text-sm"
            aria-label={s.payloadLabel}
          />
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {error}
          </p>
        ) : blindResult ? (
          <ul className="divide-y rounded-lg border overflow-hidden">
            {blindResult.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: guesses are recomputed on every decode, no stable id
              <WireFieldRow key={i} field={f} s={s} />
            ))}
          </ul>
        ) : schemaResult ? (
          <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(schemaResult, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">{s.waiting}</p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
