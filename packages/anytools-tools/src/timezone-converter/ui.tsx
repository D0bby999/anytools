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
import { COMMON_TIMEZONES, meetingTable } from './logic';

function detectLocalZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimezoneConverterUi() {
  const [datetime, setDatetime] = useState(() => new Date().toISOString().slice(0, 16));
  const [fromTz, setFromTz] = useState(detectLocalZone());
  const [selectedTzs, setSelectedTzs] = useState<string[]>([
    'UTC',
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
  ]);

  const rows = useMemo(() => {
    try {
      return meetingTable(datetime, fromTz, selectedTzs);
    } catch {
      return [];
    }
  }, [datetime, fromTz, selectedTzs]);

  const toggleTz = (tz: string) => {
    setSelectedTzs((prev) => (prev.includes(tz) ? prev.filter((t) => t !== tz) : [...prev, tz]));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Timezone Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef */}
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Time</span>
            <Input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">From timezone</span>
            <select
              value={fromTz}
              onChange={(e) => setFromTz(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => setDatetime(new Date().toISOString().slice(0, 16))}
          >
            Now
          </Button>
        </div>

        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Show in
          </span>
          <div className="flex flex-wrap gap-2">
            {COMMON_TIMEZONES.map((tz) => (
              <Button
                key={tz}
                variant={selectedTzs.includes(tz) ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleTz(tz)}
              >
                {tz.split('/').pop()}
              </Button>
            ))}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="space-y-1">
            {rows.map((r) => (
              <div
                key={r.tz}
                className="grid grid-cols-[200px,1fr,80px,auto] gap-2 items-center text-sm rounded-md border bg-muted px-3 py-2"
              >
                <span className="text-muted-foreground">{r.tz}</span>
                <code className="font-mono break-all">{r.time}</code>
                <span className="text-xs text-muted-foreground">{r.offset}</span>
                <CopyButton text={r.time} />
              </div>
            ))}
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
