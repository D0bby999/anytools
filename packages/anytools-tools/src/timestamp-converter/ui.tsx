'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import {
  COMMON_TIMEZONES,
  type ParsedTimestamp,
  formatInZone,
  parseTimestamp,
  relativeParts,
  toIso,
  toRfc2822,
  toUnixMillis,
  toUnixSeconds,
} from './logic';
import { STRINGS } from './strings';

function detectLocalZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimestampConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [zone, setZone] = useState<string>(detectLocalZone());

  const parsed = useMemo(() => {
    if (input.trim().length === 0) return null;
    try {
      return { ok: true as const, ...parseTimestamp(input) };
    } catch (e) {
      return { ok: false as const, error: toolErrorText(e, s, s.parseFailed) };
    }
  }, [input, s]);

  // Detected-format ids and the relative-time parts come from the logic layer; word them here.
  const formatLabel: Record<ParsedTimestamp['detectedFormat'], string> = {
    'unix-seconds': s.format_unixSeconds,
    'unix-millis': s.format_unixMillis,
    iso: s.format_iso,
    rfc2822: s.format_rfc2822,
    unknown: s.format_unknown,
  };
  const relativeLabel = (date: Date) => {
    const { unit, value, direction } = relativeParts(date);
    const span = s[`rel_${unit}`].replace('{n}', String(value));
    return (direction === 'future' ? s.rel_future : s.rel_past).replace('{t}', span);
  };

  const setNow = () => setInput(String(toUnixSeconds(new Date())));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
          <label className="flex-1 text-sm">
            <span className="block mb-1 text-muted-foreground">{s.inputLabel}</span>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="1779451200 or 2026-05-25T12:00:00Z"
            />
          </label>
          <Button variant="outline" onClick={setNow}>
            {s.now}
          </Button>
          <Button variant="ghost" onClick={() => setInput('')} disabled={input.length === 0}>
            {ui.clear}
          </Button>
        </div>

        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">{s.timezone}</span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        {!parsed ? (
          <p className="text-sm text-muted-foreground italic">{s.enterHint}</p>
        ) : !parsed.ok ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {parsed.error}
          </output>
        ) : (
          <div className="space-y-2">
            <Row label={s.detected} value={formatLabel[parsed.detectedFormat]} />
            <Row label={s.unixSeconds} value={String(toUnixSeconds(parsed.date))} />
            <Row label={s.unixMillis} value={String(toUnixMillis(parsed.date))} />
            <Row label="ISO 8601" value={toIso(parsed.date)} />
            <Row label="RFC 2822" value={toRfc2822(parsed.date)} />
            <Row label={s.inZone.replace('{zone}', zone)} value={formatInZone(parsed.date, zone)} />
            <Row label={s.relative} value={relativeLabel(parsed.date)} />
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px,1fr,auto] gap-2 items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <code className="font-mono break-all rounded bg-muted px-2 py-1">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}
