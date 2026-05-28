'use client';
import { Button } from '../button';
import { Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  description?: string;
  /** Optional config inputs (e.g. min/max for random number) */
  config?: ReactNode;
  /** Display area for the picked/randomized result */
  result: ReactNode;
  primaryActionLabel?: string;
  onPrimary: () => void;
  onReset?: () => void;
  disclaimer?: ReactNode;
};

/**
 * Action-result layout. Big "Pick / Generate / Roll" button at top,
 * result fills below. Random picker, dice, coin flip, name picker.
 */
export function PickerTemplate({
  title,
  description,
  config,
  result,
  primaryActionLabel = 'Pick',
  onPrimary,
  onReset,
  disclaimer,
}: Props) {
  return (
    <div className="space-y-6">
      {(title || description) && (
        <header>
          {title && <h2 className="text-2xl font-semibold mb-1">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      {config && <section className="space-y-3">{config}</section>}
      <div className="flex items-center gap-2">
        <Button type="button" size="lg" onClick={onPrimary} className="flex-1 h-12">
          <Shuffle className="h-4 w-4 mr-2" />
          {primaryActionLabel}
        </Button>
        {onReset && (
          <Button type="button" variant="outline" size="lg" onClick={onReset} className="h-12">
            Reset
          </Button>
        )}
      </div>
      <section>{result}</section>
      {disclaimer && (
        <p className="text-xs text-muted-foreground border-t pt-4 leading-relaxed">{disclaimer}</p>
      )}
    </div>
  );
}
