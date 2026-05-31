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
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import {
  COMMON_TIMEZONES,
  formatInZone,
  parseTimestamp,
  relativeFromNow,
  toIso,
  toRfc2822,
  toUnixMillis,
  toUnixSeconds,
} from './logic';

function detectLocalZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimestampConverterUi() {
  const [input, setInput] = useState('');
  const [zone, setZone] = useState<string>(detectLocalZone());

  const parsed = useMemo(() => {
    if (input.trim().length === 0) return null;
    try {
      return { ok: true as const, ...parseTimestamp(input) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Parse failed' };
    }
  }, [input]);

  const setNow = () => setInput(String(toUnixSeconds(new Date())));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Timestamp Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
          <label className="flex-1 text-sm">
            <span className="block mb-1 text-muted-foreground">
              Input — Unix seconds, millis, ISO 8601, or RFC 2822
            </span>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="1779451200 or 2026-05-25T12:00:00Z"
            />
          </label>
          <Button variant="outline" onClick={setNow}>
            Now
          </Button>
          <Button variant="ghost" onClick={() => setInput('')} disabled={input.length === 0}>
            Clear
          </Button>
        </div>

        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">Timezone</span>
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
          <p className="text-sm text-muted-foreground italic">Enter a timestamp to convert.</p>
        ) : !parsed.ok ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {parsed.error}
          </output>
        ) : (
          <div className="space-y-2">
            <Row label="Detected" value={parsed.detectedFormat} />
            <Row label="Unix seconds" value={String(toUnixSeconds(parsed.date))} />
            <Row label="Unix millis" value={String(toUnixMillis(parsed.date))} />
            <Row label="ISO 8601" value={toIso(parsed.date)} />
            <Row label="RFC 2822" value={toRfc2822(parsed.date)} />
            <Row label={`In ${zone}`} value={formatInZone(parsed.date, zone)} />
            <Row label="Relative" value={relativeFromNow(parsed.date)} />
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
