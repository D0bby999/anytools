import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, CheckboxField } from './checkbox';

describe('Checkbox', () => {
  it('reports the next state, not a toggle', async () => {
    // The trap this guards: `onCheckedChange={() => setX(!x)}` reads a stale x from the
    // closure. Radix hands you the value it is moving TO, and call sites must use it.
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="pick" checked={false} onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'pick' }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles from the keyboard', async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Checkbox aria-label="pick" checked={on} onCheckedChange={(v) => setOn(v === true)} />;
    }
    render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'pick' });

    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();

    await userEvent.keyboard(' ');
    expect(box).not.toBeChecked();
  });

  it('does not fire when disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="pick" disabled onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'pick' }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('CheckboxField', () => {
  it('toggles when the label is clicked, not just the box', async () => {
    // The hand-rolled `<label><input></label>` this replaces gave a ~16px target. The label
    // has to be part of the hit area or the touch-target work is cosmetic.
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <CheckboxField
          label="Exclude ambiguous"
          checked={on}
          onCheckedChange={(v) => setOn(v === true)}
        />
      );
    }
    render(<Harness />);

    await userEvent.click(screen.getByText('Exclude ambiguous'));

    expect(screen.getByRole('checkbox', { name: 'Exclude ambiguous' })).toBeChecked();
  });

  it('links label to control so the accessible name comes from the label', () => {
    render(<CheckboxField label="Numbers 0–9" checked={false} onCheckedChange={() => {}} />);

    expect(screen.getByRole('checkbox', { name: 'Numbers 0–9' })).toBeTruthy();
  });
});
