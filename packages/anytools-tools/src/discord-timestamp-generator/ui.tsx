'use client';
import { trackEvent } from '@anytools/analytics';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { dateTimeInputValue } from '../shared/date-input';
import { toolErrorText } from '../shared/tool-error';
import { useClientNow } from '../shared/use-client-now';
import {
  COMMON_TIMEZONES,
  TIMESTAMP_STYLES,
  discordTimestamp,
  previewText,
  requireValidDateTime,
  wallClockToEpochSeconds,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'discord-timestamp-generator';
// Zones shown under "how this looks elsewhere" — spread across offsets so the difference from
// the viewer's own zone is visible for most visitors.
const DEMO_ZONES = ['UTC', 'America/New_York', 'Asia/Tokyo'];

function detectZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function DiscordTimestampGeneratorUi() {
  const s = useLocalized(STRINGS);
  const now = useClientNow();
  const [datetime, setDatetime] = useState('');
  const [inputZone, setInputZone] = useState('UTC');
  // Empty until mount, then set from the browser's own zone — this is the value the
  // "how this looks to you" preview must use, and it must not be guessed during a
  // prerendered (clock-less, zone-less) server render.
  const [viewerZone, setViewerZone] = useState<string | null>(null);
  const counted = useRef(false);

  useEffect(() => {
    if (now) setDatetime((current) => current || dateTimeInputValue(now));
  }, [now]);
  useEffect(() => {
    setViewerZone(detectZone());
    setInputZone((current) => (current === 'UTC' ? detectZone() : current));
  }, []);

  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };

  // The detected zone is not always one of COMMON_TIMEZONES (some platforms report legacy
  // aliases like "Asia/Saigon" instead of "Asia/Ho_Chi_Minh") — without this, the <select>'s
  // value would not match any <option>, and browsers silently fall back to showing the FIRST
  // option instead, so the dropdown reads "UTC" while the codes are actually computed for the
  // real detected zone. Folding it into the list keeps what is shown and what is used in sync.
  const zoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.includes(inputZone) ? COMMON_TIMEZONES : [inputZone, ...COMMON_TIMEZONES],
    [inputZone],
  );

  const result = useMemo(() => {
    if (!datetime) return null;
    try {
      const { y, mo, d, h, mi } = requireValidDateTime(datetime);
      const epoch = wallClockToEpochSeconds(y, mo, d, h, mi, inputZone);
      return { ok: true as const, epoch };
    } catch (e) {
      return { ok: false as const, error: toolErrorText(e, s, s.invalidHint) };
    }
  }, [datetime, inputZone, s]);

  const codes = useMemo(
    () =>
      result?.ok ? TIMESTAMP_STYLES.map((style) => discordTimestamp(result.epoch, style)) : [],
    [result],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.dateTime}</span>
            <Input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.timezone}</span>
            <select
              value={inputZone}
              onChange={(e) => setInputZone(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {zoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => now && setDatetime(dateTimeInputValue(now))}
            disabled={!now}
          >
            {s.now}
          </Button>
        </div>

        {!datetime ? (
          <p className="text-sm text-muted-foreground italic">{s.enterHint}</p>
        ) : !result?.ok ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {result?.error ?? s.invalidHint}
          </output>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{s.code}</span>
              <CopyAllButton text={codes.join('\n')} label={s.copyAll} onCopy={countRun} />
            </div>
            <div className="space-y-1">
              {TIMESTAMP_STYLES.map((style) => (
                <CodeRow
                  key={style}
                  label={s[`style_${style}`]}
                  code={discordTimestamp(result.epoch, style)}
                  preview={
                    viewerZone && now
                      ? previewText(result.epoch, style, viewerZone, now.getTime())
                      : null
                  }
                  onCopy={countRun}
                />
              ))}
            </div>

            {viewerZone && (
              <p className="text-xs text-muted-foreground">
                {s.detectedZoneNote.replace('{zone}', viewerZone)}
              </p>
            )}

            {now && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.otherZonesPreview}
                </span>
                {DEMO_ZONES.map((tz) => (
                  <div key={tz} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{tz}</span>
                    <code className="font-mono">
                      {previewText(result.epoch, 'F', tz, now.getTime())}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}

function CodeRow({
  label,
  code,
  preview,
  onCopy,
}: {
  label: string;
  code: string;
  preview: string | null;
  onCopy: () => void;
}) {
  return (
    <div className="grid grid-cols-[110px,1fr,auto] items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">
        <code className="block truncate font-mono">{code}</code>
        {preview && <span className="block truncate text-xs text-muted-foreground">{preview}</span>}
      </div>
      <CopyButton text={code} onCopied={onCopy} />
    </div>
  );
}

/**
 * CopyButton's own label is fixed ("Copy"/"Copied") and not overridable — this variant needs
 * "Copy all 7" instead, so it reimplements the same copy-and-flash-a-checkmark behavior with a
 * custom label rather than reaching into CopyButton's internals.
 */
function CopyAllButton({
  text,
  label,
  onCopy,
}: { text: string; label: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const ui = useUiStrings();
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopy();
    } catch {
      // clipboard unavailable — nothing to recover from client-side
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={handleClick}>
      {copied ? ui.copied : label}
    </Button>
  );
}
