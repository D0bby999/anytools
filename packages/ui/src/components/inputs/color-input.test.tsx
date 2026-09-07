import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorInput } from './color-input';

function Harness({
  onChange,
  initial = '#0e7490',
}: { onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ColorInput
      label="Watermark colour"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('ColorInput', () => {
  it('does not call back when focus-and-blur changes nothing but the case', async () => {
    // Callers store hex however they like. qr-code-generator holds '#FFFFFF'; comparing the
    // lowercased parse against the raw value made a bare tab-through emit onChange, which
    // re-ran QR generation because the colour is in that effect's dependency array.
    const onChange = vi.fn();
    render(<ColorInput label="Light" value="#FFFFFF" onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Light'));
    await userEvent.tab();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-seats the box on the committed value when the caller rejects a change', async () => {
    // A caller that ignores onChange never updates `value`, so the [value] effect never
    // fires and the box would keep showing a colour nothing is using — with aria-invalid
    // unset, i.e. silently claiming to be committed.
    render(<ColorInput label="Fixed" value="#0e7490" onChange={() => {}} />);
    const hex = screen.getByLabelText('Fixed');

    await userEvent.clear(hex);
    await userEvent.paste('#b45309');
    await userEvent.tab();

    expect(hex).toHaveValue('#0e7490');
  });

  it('accepts a pasted hex — the reason this exists over a bare swatch', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.paste('#B45309');

    expect(onChange).toHaveBeenLastCalledWith('#b45309');
  });

  it('does not push half-typed values up to the caller', async () => {
    // `#0E749` is a prefix of a valid colour. Pushing each keystroke would thrash the
    // caller's state through nonsense and make any live preview flicker.
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.type(hex, '#0E749');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('expands #abc shorthand on blur, not on keystroke', async () => {
    // Not on keystroke, because `#abc` is also what `#abcdef` looks like three characters in:
    // expanding eagerly means typing a 6-digit hex silently commits a different colour in
    // passing. Blur is the point where the user has evidently finished.
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.paste('#abc');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  });

  it('does not flag a shorthand draft as invalid while it is being looked at', async () => {
    render(<Harness />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.paste('#abc');

    expect(hex).not.toHaveAttribute('aria-invalid');
  });

  it('marks an unparseable value invalid without calling back', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.paste('nonsense');

    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reverts a half-typed draft on blur rather than leaving it stranded', async () => {
    render(<Harness />);
    const hex = screen.getByLabelText('Watermark colour');

    await userEvent.clear(hex);
    await userEvent.type(hex, '#0E749');
    await userEvent.tab();

    expect(hex).toHaveValue('#0e7490');
  });

  it('keeps the swatch on the last good colour while the hex box is mid-edit', async () => {
    render(<Harness />);
    const hex = screen.getByLabelText('Watermark colour');
    const swatch = screen.getByLabelText('Watermark colour — picker');

    await userEvent.clear(hex);
    await userEvent.type(hex, '#0E749');

    // Native colour inputs reject anything but #RRGGBB; feeding it a partial value would
    // silently reset it to black.
    expect(swatch).toHaveValue('#0e7490');
  });
});
