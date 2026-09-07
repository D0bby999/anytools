'use client';
import { type ChangeEvent, useEffect, useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { Label } from '../label';

/**
 * Colour field: a styled swatch that opens the platform picker, plus a hex box you can type
 * or paste into.
 *
 * The typed hex is the reason this exists. 11 tools rendered a bare `<input type="color">`,
 * which on every platform is a swatch and nothing else — so the one thing a designer actually
 * wants to do, paste `#0E7490` from somewhere else, was impossible without opening the OS
 * picker and hunting for its hex box.
 *
 * The native input stays, wrapped: building a real colour picker is a large amount of surface
 * for no gain, and the platform one is what people expect from a swatch. The point of the
 * primitive is that it is the ONLY place `type="color"` appears — tool code uses this, and the
 * acceptance grep over `packages/anytools-tools/src` stays empty.
 *
 * Typing is deliberately decoupled from the committed value: the draft is held locally and
 * only pushed up once it parses. Otherwise the caller's state thrashes on the way to a legal
 * value and any live preview bound to it flickers.
 *
 * Shorthand is the subtle part. `#abc` is a legal colour, but it is also what `#abcdef` looks
 * like three keystrokes in — so expanding shorthand on every keystroke means typing `#0E7490`
 * silently commits `#00EE77` in passing, which is the exact flicker this is meant to prevent.
 * So: while typing, only a complete 6- (or 8-) digit hex commits. Shorthand is resolved on
 * blur, when the user has evidently finished.
 */
type Props = {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  /** Allow 8-digit #RRGGBBAA. The native swatch cannot express alpha, the hex box can. */
  allowAlpha?: boolean;
  disabled?: boolean;
  className?: string;
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;

/** `#abc` -> `#aabbcc`. The native input only accepts the long form. */
function expandShorthand(raw: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : raw;
}

/**
 * @param expandShort resolve `#abc` to `#aabbcc`. False while typing (see the note above),
 * true on blur and for validity display.
 */
function normalize(raw: string, allowAlpha: boolean, expandShort: boolean): string | null {
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  const candidate = expandShort ? expandShorthand(withHash.trim()) : withHash.trim();
  if (HEX6.test(candidate)) return candidate.toLowerCase();
  if (allowAlpha && HEX8.test(candidate)) return candidate.toLowerCase();
  return null;
}

export function ColorInput({
  value,
  onChange,
  label,
  allowAlpha = false,
  disabled,
  className,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value);

  // Follow the value when it changes from outside (a preset button, a reset, a swatch click).
  useEffect(() => setDraft(value), [value]);

  const commitDraft = (raw: string) => {
    setDraft(raw);
    const parsed = normalize(raw, allowAlpha, false);
    if (parsed) onChange(parsed);
  };

  // Blur is where shorthand resolves, and where a draft that never parsed snaps back to the
  // committed value rather than sitting there as stranded red text.
  const handleBlur = () => {
    const parsed = normalize(draft, allowAlpha, true);
    if (parsed && parsed !== value) {
      onChange(parsed);
      setDraft(parsed);
      return;
    }
    setDraft(parsed ?? value);
  };

  const handleSwatch = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    onChange(e.target.value);
  };

  // Validity display DOES accept shorthand — `#abc` should not read as an error while the
  // user is looking at it, even though it does not commit until blur.
  const invalid = normalize(draft, allowAlpha, true) === null;
  // The native swatch rejects anything but #RRGGBB, so feed it the last good value while the
  // hex box holds a half-typed one.
  const swatchValue = normalize(draft, false, true) ?? normalize(value, false, true) ?? '#000000';

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label htmlFor={`${id}-hex`}>{label}</Label>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatchValue}
          onChange={handleSwatch}
          disabled={disabled}
          aria-label={label ? `${label} — picker` : 'Colour picker'}
          // Native colour inputs draw their own inset border and padding; stripping those and
          // sizing the wrapper is what makes it read as part of the design system.
          className={cn(
            'h-11 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            '[&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none',
            '[&::-webkit-color-swatch-wrapper]:p-0',
          )}
        />
        <input
          id={`${id}-hex`}
          type="text"
          value={draft}
          onChange={(e) => commitDraft(e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          aria-invalid={invalid || undefined}
          placeholder={allowAlpha ? '#0e7490ff' : '#0e7490'}
          className={cn(
            'h-11 w-full rounded-md border bg-background px-3 font-mono text-sm uppercase ring-offset-background',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            invalid ? 'border-destructive' : 'border-input',
          )}
        />
      </div>
    </div>
  );
}
