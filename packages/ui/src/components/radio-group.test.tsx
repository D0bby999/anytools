import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup, RadioGroupField } from './radio-group';

function Harness({ onValueChange }: { onValueChange?: (v: string) => void } = {}) {
  const [value, setValue] = useState('all');
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onValueChange?.(v);
      }}
      aria-label="Pages"
    >
      <RadioGroupField value="all" label="All pages" />
      <RadioGroupField value="range" label="Page range" description="e.g. 2-5, 8" />
      <RadioGroupField value="none" label="None" disabled />
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('selects by clicking the label, and reports the new value', async () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await userEvent.click(screen.getByText('Page range'));

    expect(onValueChange).toHaveBeenCalledWith('range');
    expect(screen.getByRole('radio', { name: /Page range/ })).toBeChecked();
  });

  // NOT tested here: arrow-key roving between options. Radix's RovingFocusGroup does not
  // initialise under happy-dom OR jsdom — the checked item keeps tabindex="-1" and arrow keys
  // are inert, and raw @radix-ui/react-radio-group behaves identically outside this wrapper,
  // so it is the test DOM and not our code. Asserting it here would mean asserting something
  // the environment cannot exercise. Keyboard navigation is on the phase's browser smoke
  // checklist instead.

  it('exposes the group as one labelled radiogroup', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'Pages' })).toBeInTheDocument();
  });

  it('renders the description as part of the option, not a separate control', () => {
    render(<Harness />);

    expect(screen.getByText('e.g. 2-5, 8')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('skips a disabled option', async () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await userEvent.click(screen.getByText('None'));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
