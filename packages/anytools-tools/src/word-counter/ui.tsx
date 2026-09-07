'use client';
import {
  CalculatorTemplate,
  TableResult,
  Textarea,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { countText } from './logic';
import { STRINGS } from './strings';

const TWITTER_LIMIT = 280;
const INSTAGRAM_BIO_LIMIT = 150;

export function WordCounterUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [text, setText] = useState('');

  const { chars, charsNoSpaces, words, sentences, paragraphs } = countText(text);

  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={s.placeholder}
            className="min-h-[300px] font-mono text-sm"
            aria-label={s.textToCount}
          />
        </>
      }
      result={
        <>
          <TableResult
            rows={[
              { label: s.words, value: fmt(words), emphasis: true },
              { label: s.characters, value: fmt(chars), emphasis: true },
              { label: s.charactersNoSpaces, value: fmt(charsNoSpaces) },
              { label: s.sentences, value: fmt(sentences) },
              { label: s.paragraphs, value: fmt(paragraphs) },
            ]}
          />
          <TableResult
            title={s.platformLimits}
            rows={[
              {
                label: s.twitter,
                value: `${fmt(chars)} / ${TWITTER_LIMIT}`,
                emphasis: chars > TWITTER_LIMIT,
              },
              {
                label: s.instagramBio,
                value: `${fmt(chars)} / ${INSTAGRAM_BIO_LIMIT}`,
                emphasis: chars > INSTAGRAM_BIO_LIMIT,
              },
            ]}
          />
        </>
      }
    />
  );
}
