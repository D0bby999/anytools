'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Label,
  PrivacyNote,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { DEFAULT_INPUT, LIMITS, type MetaInput, generateMetaTags, validate } from './logic';
import { STRINGS } from './strings';

/** Localized text for a coded message returned by the logic layer, falling back to its English. */
function localizedMessage(
  table: Record<string, string>,
  key: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const template = table[key];
  if (!template) return fallback;
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template,
  );
}

export function MetaTagGeneratorUi() {
  const s = useLocalized(STRINGS);
  const [input, setInput] = useState<MetaInput>({
    ...DEFAULT_INPUT,
    title: 'How to merge PDFs without uploading them',
    description:
      'A short, specific summary of the page — this is what shows under the title in search results.',
    url: 'https://example.com/blog/merge-pdf',
    siteName: 'Example',
  });

  const set = <K extends keyof MetaInput>(key: K, value: MetaInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  const output = useMemo(() => generateMetaTags(input), [input]);
  const warnings = useMemo(() => validate(input), [input]);

  const field = (key: keyof MetaInput, label: string, placeholder = '', limit?: number) => (
    <label className="block text-sm">
      <span className="mb-1 flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        {limit && (
          <span className={String(input[key]).length > limit ? 'text-amber-600' : ''}>
            {String(input[key]).length}/{limit}
          </span>
        )}
      </span>
      <input
        value={String(input[key])}
        onChange={(e) => set(key, e.target.value as MetaInput[typeof key])}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {field('title', s.pageTitle, s.pageTitlePlaceholder, LIMITS.title)}

        <label className="block text-sm">
          <span className="mb-1 flex items-center justify-between text-muted-foreground">
            <span>{s.description}</span>
            <span className={input.description.length > LIMITS.description ? 'text-amber-600' : ''}>
              {input.description.length}/{LIMITS.description}
            </span>
          </span>
          <Textarea
            value={input.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field('url', s.canonicalUrl, 'https://example.com/page')}
          {field('imageUrl', s.previewImageUrl, 'https://example.com/og.png')}
          {field('siteName', s.siteName, 'Example')}
          {field('author', s.author, s.optional)}
          {field('twitterHandle', s.twitterHandle, '@example')}
          <div className="space-y-1.5">
            <Label htmlFor="meta-card-type">{s.cardType}</Label>
            <Select
              value={input.cardType}
              onValueChange={(v) => set('cardType', v as MetaInput['cardType'])}
            >
              <SelectTrigger id="meta-card-type">
                <SelectValue>
                  {input.cardType === 'summary' ? s.cardSummary : s.cardLargeImage}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summary_large_image">{s.cardLargeImage}</SelectItem>
                <SelectItem value="summary">{s.cardSummary}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meta-robots">{s.robots}</Label>
            <Select
              value={input.robots}
              onValueChange={(v) => set('robots', v as MetaInput['robots'])}
            >
              <SelectTrigger id="meta-robots">
                <SelectValue>{input.robots}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="index, follow">index, follow</SelectItem>
                <SelectItem value="noindex, follow">noindex, follow</SelectItem>
                <SelectItem value="noindex, nofollow">noindex, nofollow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field('locale', 'og:locale', 'en_US')}
        </div>

        {warnings.length > 0 && (
          <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {warnings.map((w) => (
              <p key={`${w.field}-${w.code}`}>
                {localizedMessage(s, `error_${w.code}`, w.params, w.message)}
              </p>
            ))}
          </output>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm text-muted-foreground">{s.pasteIntoHead}</h3>
            <CopyButton text={output} />
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
            <code>{output}</code>
          </pre>
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
