'use client';
import { RangeSlider, TableResult, Textarea } from '@anytools/ui';
import { useState } from 'react';
import { estimateReadingTime, formatDuration } from './logic';

export function ReadingTimeUi() {
  const [text, setText] = useState('');
  const [readWpm, setReadWpm] = useState(238);

  const {
    words,
    readSeconds: readSec,
    speakSeconds: speakSec,
    skimSeconds: skimSec,
  } = estimateReadingTime(text, readWpm);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Reading Time Estimator</h2>
        <p className="text-sm text-muted-foreground">
          Average adult reads 238 WPM, speaks 150 WPM, skims 450 WPM.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your text..."
            className="min-h-[300px] font-mono text-sm"
            aria-label="Text"
          />
          <RangeSlider
            value={readWpm}
            onChange={setReadWpm}
            min={100}
            max={500}
            step={10}
            label="Reading speed"
            unit="WPM"
          />
        </div>
        <div className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
          <TableResult
            rows={[
              { label: 'Words', value: words.toLocaleString(), emphasis: true },
              { label: `Read (${readWpm} WPM)`, value: formatDuration(readSec), emphasis: true },
              { label: 'Speak (150 WPM)', value: formatDuration(speakSec) },
              { label: 'Skim (450 WPM)', value: formatDuration(skimSec) },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
