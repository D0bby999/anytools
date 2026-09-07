'use client';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef, useId } from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

/**
 * Checkbox — "pick any number of these". For "turn one mode on or off" the answer is a
 * Switch, and for "pick exactly one" it is RadioGroup or SegmentedControl.
 *
 * Replaces the `<input type="checkbox" className="h-4 w-4">` that 28 tools hand-rolled. Those
 * rendered the operating system's own widget, which is the single loudest reason the tool
 * pages looked unfinished next to the rest of the design system.
 *
 * Note the callback shape: Radix reports the NEXT state via onCheckedChange. Write
 * `onCheckedChange={(v) => setX(v === true)}`, never `onCheckedChange={() => setX(!x)}` —
 * the latter reads a stale value out of the closure and desynchronises from the tick.
 */
const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-5 w-5 shrink-0 rounded border border-input ring-offset-background',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

/**
 * Checkbox plus its label, as one ≥44px touch target.
 *
 * The hand-rolled version in the tools was `<label class="flex items-center gap-1">` around a
 * bare input: a ~16px target, below every touch guideline. Almost every call site wants this,
 * not the bare primitive.
 *
 * The row is made hittable by stretching the label over it (`after:absolute after:inset-0`),
 * not merely by giving the wrapper `min-h-11`. A tall div with no handler looks like a large
 * target in the markup and is still a 20px one under a thumb.
 */
type CheckboxFieldProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label: string;
  /** Wrapper class, not the control's — the control is positioned by this component. */
  containerClassName?: string;
};

const CheckboxField = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxFieldProps>(
  ({ label, containerClassName, id, className, ...props }, ref) => {
    // useId, not a slug of the label. `\W` is ASCII-only, so "Số trang" and "Sổ trang" both
    // collapse to "cb-s-trang" — duplicate ids, and <label for> binds to whichever came first,
    // so tapping one option toggles the other. This app ships vi/es/pt; the collision is a
    // matter of which labels a future tool happens to use.
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <div className={cn('relative flex min-h-11 items-center gap-2', containerClassName)}>
        <Checkbox ref={ref} id={inputId} className={className} {...props} />
        <Label
          htmlFor={inputId}
          className="cursor-pointer select-none after:absolute after:inset-0 after:content-['']"
        >
          {label}
        </Label>
      </div>
    );
  },
);
CheckboxField.displayName = 'CheckboxField';

export { Checkbox, CheckboxField };
