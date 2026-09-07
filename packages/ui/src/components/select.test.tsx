import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

function Harness({ onValueChange }: { onValueChange?: (v: string) => void } = {}) {
  const [value, setValue] = useState('hex');
  return (
    <div>
      <Label htmlFor="enc">Output encoding</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onValueChange?.(v);
        }}
      >
        <SelectTrigger id="enc">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hex">Hex</SelectItem>
          <SelectItem value="base64">Base64</SelectItem>
          <SelectItem value="base64url">Base64 URL</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

describe('Select', () => {
  it('shows the selected value on the trigger', () => {
    render(<Harness />);

    expect(screen.getByRole('combobox', { name: 'Output encoding' })).toHaveTextContent('Hex');
  });

  it('takes its accessible name from an associated Label', () => {
    // The native <select> this replaces was usually wrapped in a bare <label>. Radix renders
    // a button, so the association has to be explicit — if this breaks, 38 tools ship an
    // unnamed control.
    render(<Harness />);

    expect(screen.getByRole('combobox', { name: 'Output encoding' })).toBeInTheDocument();
  });

  it('reports the new value when an option is chosen', async () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Base64' }));

    expect(onValueChange).toHaveBeenCalledWith('base64');
    expect(screen.getByRole('combobox')).toHaveTextContent('Base64');
  });

  it('marks the current option as selected when open', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Hex', selected: true })).toBeInTheDocument();
  });

  it('does not open when disabled', async () => {
    render(
      <Select disabled value="hex">
        <SelectTrigger aria-label="Encoding">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hex">Hex</SelectItem>
        </SelectContent>
      </Select>,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Encoding' }));

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
