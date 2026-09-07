'use client';
import {
  Input,
  NumberStepper,
  NumericPrimary,
  PickerTemplate,
  SegmentedControl,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useState } from 'react';
import { flipCoin, parseListItems, pickOne, randomInt, rollDice } from './logic';
import { STRINGS } from './strings';

type Mode = 'dice' | 'coin' | 'number' | 'pick';

export function RandomPickerUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<Mode>('dice');
  const [diceCount, setDiceCount] = useState(2);
  const [diceSides, setDiceSides] = useState(6);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [list, setList] = useState('Alice\nBob\nCharlie\nDana');
  const [result, setResult] = useState<string>('—');

  const pick = () => {
    if (mode === 'dice') {
      const { rolls, sum } = rollDice(diceCount, diceSides);
      setResult(`${rolls.join(' + ')} = ${sum}`);
    } else if (mode === 'coin') {
      setResult(flipCoin() === 'Heads' ? s.heads : s.tails);
    } else if (mode === 'number') {
      setResult(String(randomInt(min, max)));
    } else {
      const items = parseListItems(list);
      setResult(pickOne(items) ?? '—');
    }
  };

  return (
    <PickerTemplate
      title={s.title}
      description={s.description}
      primaryActionLabel={
        mode === 'dice'
          ? s.roll
          : mode === 'coin'
            ? s.flip
            : mode === 'number'
              ? ui.generate
              : s.pick
      }
      onPrimary={pick}
      config={
        <>
          <SegmentedControl
            value={mode}
            onChange={(m) => {
              setMode(m);
              setResult('—');
            }}
            options={[
              { value: 'dice', label: s.dice },
              { value: 'coin', label: s.coin },
              { value: 'number', label: s.number },
              { value: 'pick', label: s.pick },
            ]}
            label={s.mode}
          />
          {mode === 'dice' && (
            <>
              <NumberStepper
                value={diceCount}
                onChange={setDiceCount}
                min={1}
                max={20}
                label={s.diceCount}
              />
              <NumberStepper
                value={diceSides}
                onChange={setDiceSides}
                min={2}
                max={100}
                label={s.sidesPerDie}
              />
            </>
          )}
          {mode === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1.5 block text-sm font-medium">{s.min}</span>
                <Input
                  type="number"
                  value={min}
                  onChange={(e) => setMin(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label={s.min}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium">{s.max}</span>
                <Input
                  type="number"
                  value={max}
                  onChange={(e) => setMax(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label={s.max}
                />
              </div>
            </div>
          )}
          {mode === 'pick' && (
            <div>
              <span className="mb-1.5 block text-sm font-medium">{s.itemsOnePerLine}</span>
              <Textarea
                value={list}
                onChange={(e) => setList(e.target.value)}
                className="min-h-[160px] font-mono text-sm"
                aria-label={s.listItems}
              />
            </div>
          )}
        </>
      }
      result={<NumericPrimary label={ui.result} value={result} />}
    />
  );
}
