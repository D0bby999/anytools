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

  it('is a single tab stop that delegates focus to the selected option', async () => {
    // Roving tabindex is the reason to use a radio group over three buttons: the group is one
    // stop in the tab order, not three. The GROUP carries tabindex=0 and every item is -1
    // until the group receives focus and hands it to the checked one.
    //
    // This also documents how the control must be driven in a test. Calling .focus() on an
    // item directly skips that delegation, leaves Radix's currentTabStopId unset, and makes
    // the arrow keys look broken — a trap that nearly got recorded here as a component defect.
    render(<Harness />);

    await userEvent.tab();

    const selected = screen.getByRole('radio', { name: 'All pages' });
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /Page range/ })).toHaveAttribute('tabindex', '-1');
  });

  // NOT asserted here: arrow keys moving the selection. Focus delegation above works under
  // happy-dom, but the keydown handling on top of it does not — and the same interaction is
  // confirmed working in real Chrome, so this is a narrow gap in the test DOM rather than a
  // defect. It is covered by the phase's browser smoke check instead of being faked here.

  it('exposes the group as one labelled radiogroup', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'Pages' })).toBeInTheDocument();
  });

  it('announces the description through the option, not merely beside it', () => {
    // Asserting the text is "in the document" passes for any visually-present string and
    // proves nothing: a screen-reader user picking "Page range" still would not hear
    // "e.g. 2-5, 8", which is the entire point of the prop.
    render(<Harness />);

    expect(
      screen.getByRole('radio', { name: /Page range/, description: 'e.g. 2-5, 8' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('skips a disabled option', async () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await userEvent.click(screen.getByText('None'));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
