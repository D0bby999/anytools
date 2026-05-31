'use client';
import { TableResult, Textarea } from '@anytools/ui';
import { useState } from 'react';
import { countText } from './logic';

const TWITTER_LIMIT = 280;
const INSTAGRAM_BIO_LIMIT = 150;

export function WordCounterUi() {
  const [text, setText] = useState('');

  const { chars, charsNoSpaces, words, sentences, paragraphs } = countText(text);

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Word & Character Counter</h2>
        <p className="text-sm text-muted-foreground">
          Live counts. Twitter/X and Instagram bio limits tracked.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or type your text..."
            className="min-h-[300px] font-mono text-sm"
            aria-label="Text to count"
          />
        </div>
        <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TableResult
            rows={[
              { label: 'Words', value: fmt(words), emphasis: true },
              { label: 'Characters', value: fmt(chars), emphasis: true },
              { label: 'Characters (no spaces)', value: fmt(charsNoSpaces) },
              { label: 'Sentences', value: fmt(sentences) },
              { label: 'Paragraphs', value: fmt(paragraphs) },
            ]}
          />
          <TableResult
            title="Platform limits"
            rows={[
              {
                label: 'Twitter / X',
                value: `${fmt(chars)} / ${TWITTER_LIMIT}`,
                emphasis: chars > TWITTER_LIMIT,
              },
              {
                label: 'Instagram bio',
                value: `${fmt(chars)} / ${INSTAGRAM_BIO_LIMIT}`,
                emphasis: chars > INSTAGRAM_BIO_LIMIT,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
