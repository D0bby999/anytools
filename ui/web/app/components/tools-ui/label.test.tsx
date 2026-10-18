import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Input } from './input';
import { Label } from './label';

describe('Label', () => {
  it('focuses its control when clicked', async () => {
    render(
      <div>
        <Label htmlFor="secret">Secret key</Label>
        <Input id="secret" />
      </div>,
    );

    await userEvent.click(screen.getByText('Secret key'));

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('gives the control its accessible name', () => {
    render(
      <div>
        <Label htmlFor="secret">Secret key</Label>
        <Input id="secret" />
      </div>,
    );

    expect(screen.getByRole('textbox', { name: 'Secret key' })).toBeInTheDocument();
  });
});
