'use client';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef, useId } from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

/**
 * Radio group — "pick exactly one", where the options need their own labels or are too many
 * for a segmented control.
 *
 * SegmentedControl is the better answer for two or three short options shown side by side; it
 * already exists and 25 tools use it. Reach for this when the options carry descriptions, or
 * when there are more than about four.
 *
 * Replaces the `<input type="radio">` in 9 tools — 7 of them in the PDF cluster, where the
 * choice is usually "which pages" or "what to do with the result".
 */
const RadioGroup = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-1', className)} {...props} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'aspect-square h-5 w-5 shrink-0 rounded-full border border-input text-accent ring-offset-background',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-accent',
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="block h-2.5 w-2.5 rounded-full bg-accent" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

/**
 * One option row: control, label, optional description.
 *
 * The row is hittable via a stretched label (`after:absolute after:inset-0`), not just a tall
 * wrapper — a `min-h-11` div with no handler is a large target in the markup and a 20px one
 * under a thumb. The description is wired through `aria-describedby`, or a screen-reader user
 * picking "Page range" never hears "e.g. 2-5, 8", which is the whole point of the prop.
 */
type RadioGroupFieldProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
  label: string;
  description?: string;
  containerClassName?: string;
};

const RadioGroupField = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupFieldProps
>(({ label, description, containerClassName, id, className, value, ...props }, ref) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descId = `${inputId}-desc`;
  return (
    <div className={cn('relative flex min-h-11 items-start gap-2 py-1', containerClassName)}>
      <RadioGroupItem
        ref={ref}
        id={inputId}
        value={value}
        aria-describedby={description ? descId : undefined}
        className={cn('mt-0.5', className)}
        {...props}
      />
      <div className="grid gap-0.5">
        <Label
          htmlFor={inputId}
          className="cursor-pointer select-none after:absolute after:inset-0 after:content-['']"
        >
          {label}
        </Label>
        {description && (
          <span id={descId} className="text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </div>
  );
});
RadioGroupField.displayName = 'RadioGroupField';

export { RadioGroup, RadioGroupItem, RadioGroupField };
