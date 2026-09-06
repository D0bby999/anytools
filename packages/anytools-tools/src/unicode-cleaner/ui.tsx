'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import {
  type UnicodeIssue,
  buildHighlightSegments,
  cleanText,
  formatCodePoint,
  scanText,
} from './logic';
import { STRINGS } from './strings';

/** Invisible issues render nothing on their own, so the preview needs a stand-in glyph the
 * user can actually see and hover for the real name. Homoglyphs render their own character —
 * that IS the point, seeing the look-alike sitting in the sentence. */
function previewGlyph(issue: UnicodeIssue): string {
  return issue.kind === 'invisible' ? '·' : issue.char;
}

export function UnicodeCleanerUi() {
  const s = useLocalized(STRINGS);
  const [text, setText] = useState('');

  const issues = useMemo(() => scanText(text), [text]);
  const segments = useMemo(() => buildHighlightSegments(text, issues), [text, issues]);
  const invisibleCount = issues.filter((i) => i.kind === 'invisible').length;
  const homoglyphCount = issues.filter((i) => i.kind === 'homoglyph').length;

  const handleClean = () => {
    const { cleaned } = cleanText(text);
    setText(cleaned);
    trackEvent('tool_run', { tool: 'unicode-cleaner' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {s.inputLabel}
          </span>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={s.placeholder}
            className="min-h-[180px] font-mono text-sm"
            aria-label={s.inputLabel}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleClean} disabled={issues.length === 0}>
            {s.cleanButton}
          </Button>
          <CopyButton text={text} />
          {issues.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {s.issuesSummary.replace('{count}', String(issues.length))}
            </span>
          )}
          {invisibleCount > 0 && (
            <Badge variant="secondary">{`${s.invisibleBadge} ${invisibleCount}`}</Badge>
          )}
          {homoglyphCount > 0 && (
            <Badge variant="destructive">{`${s.homoglyphBadge} ${homoglyphCount}`}</Badge>
          )}
        </div>

        {text.length === 0 ? null : issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noIssues}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {s.previewLabel}
              </span>
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
                {segments.map((segment, i) =>
                  segment.issue ? (
                    <mark
                      // biome-ignore lint/suspicious/noArrayIndexKey: ephemeral render of a scan result
                      key={`issue-${i}`}
                      title={`${segment.issue.name} (${formatCodePoint(segment.issue.codePoint)})`}
                      className={
                        segment.issue.kind === 'invisible'
                          ? 'bg-destructive/20 text-destructive px-0.5 rounded'
                          : 'bg-warning/20 text-warning-foreground px-0.5 rounded underline decoration-wavy'
                      }
                    >
                      {previewGlyph(segment.issue)}
                    </mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ephemeral render of a scan result
                    <span key={`text-${i}`}>{segment.text}</span>
                  ),
                )}
              </pre>
            </div>

            <div>
              <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {s.detailsLabel}
              </span>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{s.position}</th>
                      <th className="px-3 py-2 font-medium">{s.character}</th>
                      <th className="px-3 py-2 font-medium">{s.codePointCol}</th>
                      <th className="px-3 py-2 font-medium">{s.nameCol}</th>
                      <th className="px-3 py-2 font-medium">{s.looksLikeCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue) => (
                      <tr key={`${issue.index}-${issue.codePoint}`} className="border-t">
                        <td className="px-3 py-1.5">{issue.index + 1}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {issue.kind === 'invisible' ? previewGlyph(issue) : issue.char}
                        </td>
                        <td className="px-3 py-1.5 font-mono">
                          {formatCodePoint(issue.codePoint)}
                        </td>
                        <td className="px-3 py-1.5">{issue.name}</td>
                        <td className="px-3 py-1.5 font-mono">{issue.looksLike ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {homoglyphCount > 0 && (
              <p className="text-xs text-muted-foreground">{s.heuristicNote}</p>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
