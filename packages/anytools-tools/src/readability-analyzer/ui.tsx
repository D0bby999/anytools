'use client';
import {
  CalculatorTemplate,
  TableResult,
  Textarea,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { type ReadingLevelId, analyze } from './logic';
import { STRINGS } from './strings';

export function ReadabilityAnalyzerUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [text, setText] = useState(
    'The quick brown fox jumps over the lazy dog. This is a short sentence. Readability metrics work best on at least a few paragraphs of prose.',
  );
  const r = analyze(text);
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  // The logic layer names the level in English and tags it with an id; map the id here.
  const levelLabel: Record<ReadingLevelId, string> = {
    universal: s.level_universal,
    collegeGraduate: s.level_collegeGraduate,
    college: s.level_college,
    grade10to12: s.level_grade10to12,
    grade8to9: s.level_grade8to9,
    grade7: s.level_grade7,
    grade6: s.level_grade6,
  };

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
            aria-label={s.text}
          />
        </>
      }
      result={
        <>
          {r ? (
            <TableResult
              rows={[
                { label: s.words, value: r.words.toLocaleString(locale) },
                { label: s.sentences, value: r.sentences.toLocaleString(locale) },
                { label: s.syllables, value: r.syllables.toLocaleString(locale) },
                { label: s.fleschEase, value: fmt(r.flesch), emphasis: true },
                { label: s.fkGrade, value: fmt(r.fkGrade), emphasis: true },
                { label: s.gunningFog, value: fmt(r.fog) },
                { label: s.readingLevel, value: levelLabel[r.levelId] ?? r.level, emphasis: true },
              ]}
            />
          ) : (
            <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              {s.enterText}
            </div>
          )}
        </>
      }
    />
  );
}
