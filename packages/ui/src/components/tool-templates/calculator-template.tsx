'use client';
import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStrings } from '../../i18n/ui-strings';
import { Button } from '../button';

type Props = {
  title?: string;
  description?: string;
  inputs: ReactNode;
  result: ReactNode;
  onReset?: () => void;
  actions?: ReactNode;
  disclaimer?: ReactNode;
};

/**
 * Two-pane calculator layout. Stacks on mobile, side-by-side on desktop.
 * BMI/Tip/Compound Interest/GPA all use this shape.
 */
export function CalculatorTemplate({
  title,
  description,
  inputs,
  result,
  onReset,
  actions,
  disclaimer,
}: Props) {
  const ui = useUiStrings();
  return (
    <div className="space-y-6">
      {(title || description) && (
        <header>
          {title && <h2 className="text-2xl font-semibold mb-1">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 space-y-4">{inputs}</section>
        <aside className="lg:col-span-2 space-y-4 lg:sticky lg:top-20 lg:self-start">
          {result}
          {(onReset || actions) && (
            <div className="flex items-center gap-2">
              {onReset && (
                <Button type="button" variant="outline" size="sm" onClick={onReset}>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  {ui.reset}
                </Button>
              )}
              {actions}
            </div>
          )}
        </aside>
      </div>
      {disclaimer && (
        <p className="text-xs text-muted-foreground border-t pt-4 leading-relaxed">{disclaimer}</p>
      )}
    </div>
  );
}
