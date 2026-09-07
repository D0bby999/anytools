'use client';
import * as LabelPrimitive from '@radix-ui/react-label';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Form label. Radix rather than a bare <label> for one behaviour that matters on touch:
 * it suppresses text selection on double-click, so a fat-fingered double tap on a label
 * next to a checkbox does not select the word instead of toggling the control.
 */
const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
