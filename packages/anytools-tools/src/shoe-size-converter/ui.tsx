'use client';
import { Input, SegmentedControl, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { type Demographic, type System, findClosest } from './logic';

export function ShoeSizeConverterUi() {
  const [demo, setDemo] = useState<Demographic>('men');
  const [system, setSystem] = useState<System>('us');
  const [value, setValue] = useState(10);

  const closest = findClosest(demo, system, value);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Shoe Size Converter</h2>
        <p className="text-sm text-muted-foreground">
          Approximate. Brand sizing varies — when in doubt, measure your foot.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SegmentedControl
          value={demo}
          onChange={setDemo}
          options={[
            { value: 'men', label: 'Men' },
            { value: 'women', label: 'Women' },
          ]}
          label="Demographic"
        />
        <SegmentedControl
          value={system}
          onChange={setSystem}
          options={[
            { value: 'us', label: 'US' },
            { value: 'eu', label: 'EU' },
            { value: 'uk', label: 'UK' },
            { value: 'cm', label: 'cm' },
          ]}
          label="Input system"
        />
      </div>
      <div>
        <span className="block text-sm font-medium mb-1.5">Size ({system.toUpperCase()})</span>
        <Input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.valueAsNumber || 0)}
          className="h-11 tabular-nums text-lg"
          step={0.5}
          aria-label="Size value"
        />
      </div>
      <TableResult
        title={`Equivalent (${demo})`}
        rows={[
          { label: 'US', value: String(closest.us), emphasis: system === 'us' },
          { label: 'EU', value: String(closest.eu), emphasis: system === 'eu' },
          { label: 'UK', value: String(closest.uk), emphasis: system === 'uk' },
          { label: 'JP / cm', value: `${closest.cm} cm`, emphasis: system === 'cm' },
        ]}
      />
    </div>
  );
}
