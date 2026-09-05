'use client';
import { RangeSlider, TableResult, Textarea, useLocalized, useToolLocale } from '@anytools/ui';
import { useState } from 'react';
import { durationParts, estimateReadingTime } from './logic';
import { STRINGS } from './strings';

export function ReadingTimeUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [text, setText] = useState('');
  const [readWpm, setReadWpm] = useState(238);

  const {
    words,
    readSeconds: readSec,
    speakSeconds: speakSec,
    skimSeconds: skimSec,
  } = estimateReadingTime(text, readWpm);

  // Same split as `formatDuration`, phrased with the page's own strings.
  const duration = (totalSeconds: number) => {
    const { minutes, seconds } = durationParts(totalSeconds);
    const template =
      minutes === 0 ? s.durSeconds : seconds === 0 ? s.durMinutes : s.durMinutesSeconds;
    return template.replace('{m}', String(minutes)).replace('{s}', String(seconds));
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={s.placeholder}
            className="min-h-[300px] font-mono text-sm"
            aria-label={s.text}
          />
          <RangeSlider
            value={readWpm}
            onChange={setReadWpm}
            min={100}
            max={500}
            step={10}
            label={s.readingSpeed}
            unit="WPM"
          />
        </div>
        <div className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
          <TableResult
            rows={[
              { label: s.words, value: words.toLocaleString(locale), emphasis: true },
              {
                label: s.read.replace('{wpm}', String(readWpm)),
                value: duration(readSec),
                emphasis: true,
              },
              { label: s.speak, value: duration(speakSec) },
              { label: s.skim, value: duration(skimSec) },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
