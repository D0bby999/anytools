'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { DEFAULT_INPUT, LIMITS, type MetaInput, generateMetaTags, validate } from './logic';

export function MetaTagGeneratorUi() {
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
        <CardTitle className="text-xl">Meta Tag Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {field('title', 'Page title', 'Shown as the headline in search results', LIMITS.title)}

        <label className="block text-sm">
          <span className="mb-1 flex items-center justify-between text-muted-foreground">
            <span>Description</span>
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
          {field('url', 'Canonical URL', 'https://example.com/page')}
          {field('imageUrl', 'Preview image URL', 'https://example.com/og.png')}
          {field('siteName', 'Site name', 'Example')}
          {field('author', 'Author', 'Optional')}
          {field('twitterHandle', 'X / Twitter handle', '@example')}
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Card type</span>
            <select
              value={input.cardType}
              onChange={(e) => set('cardType', e.target.value as MetaInput['cardType'])}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="summary_large_image">Large image</option>
              <option value="summary">Summary</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Robots</span>
            <select
              value={input.robots}
              onChange={(e) => set('robots', e.target.value as MetaInput['robots'])}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="index, follow">index, follow</option>
              <option value="noindex, follow">noindex, follow</option>
              <option value="noindex, nofollow">noindex, nofollow</option>
            </select>
          </label>
          {field('locale', 'og:locale', 'en_US')}
        </div>

        {warnings.length > 0 && (
          <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {warnings.map((w) => (
              <p key={`${w.field}-${w.message}`}>{w.message}</p>
            ))}
          </output>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm text-muted-foreground">Paste into &lt;head&gt;</h3>
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
