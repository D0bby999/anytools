'use client';
import { TableResult, Textarea } from '@anytools/ui';
import { useState } from 'react';
import { analyze } from './logic';

export function ReadabilityAnalyzerUi() {
  const [text, setText] = useState(
    'The quick brown fox jumps over the lazy dog. This is a short sentence. Readability metrics work best on at least a few paragraphs of prose.',
  );
  const r = analyze(text);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Readability Analyzer</h2>
        <p className="text-sm text-muted-foreground">
          Flesch Reading Ease, Flesch-Kincaid Grade Level, Gunning Fog. English text only.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
            aria-label="Text"
          />
        </div>
        <div className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
          {r ? (
            <TableResult
              rows={[
                { label: 'Words', value: r.words.toLocaleString() },
                { label: 'Sentences', value: r.sentences.toLocaleString() },
                { label: 'Syllables', value: r.syllables.toLocaleString() },
                { label: 'Flesch Reading Ease', value: fmt(r.flesch), emphasis: true },
                { label: 'Flesch-Kincaid Grade', value: fmt(r.fkGrade), emphasis: true },
                { label: 'Gunning Fog', value: fmt(r.fog) },
                { label: 'Reading level', value: r.level, emphasis: true },
              ]}
            />
          ) : (
            <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              Enter text.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
