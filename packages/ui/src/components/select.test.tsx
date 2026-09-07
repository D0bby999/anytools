import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
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

describe('Select server rendering', () => {
  // Every tool page here is prerendered. Radix resolves the trigger's text by portalling
  // SelectItemText into the value node, which is a client-only effect — so a bare
  // <SelectValue /> ships an EMPTY trigger in the static HTML and only fills in after
  // hydration. The native <select> it replaces put the selected option in the markup, so
  // this would be a visible regression: a page of blank boxes on a slow connection. No
  // browser smoke can catch it, because smoke runs post-hydration.
  const markup = (child: React.ReactNode) =>
    renderToString(
      <Select value="hex">
        <SelectTrigger aria-label="Encoding">{child}</SelectTrigger>
        <SelectContent>
          <SelectItem value="hex">Hex</SelectItem>
        </SelectContent>
      </Select>,
    );

  it('renders the current label into the static HTML when given children', () => {
    expect(markup(<SelectValue>Hex</SelectValue>)).toContain('Hex');
  });

  it('documents that a bare SelectValue does NOT', () => {
    // Kept as an executable note: if a future Radix release fixes this, the assertion fails
    // and the workaround at every call site can be dropped.
    expect(markup(<SelectValue />)).not.toContain('Hex');
  });
});

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
