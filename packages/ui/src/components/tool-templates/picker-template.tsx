'use client';
import { Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../button';

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
      {/* A div, not a p: `disclaimer` is a ReactNode and the obvious thing to pass is
          PrivacyNote, which renders its own paragraph. A nested paragraph is invalid HTML — the
          parser closes the outer one, so server markup and client tree diverge and React throws
          a hydration error. Found the first time a tool actually passed it, in Phase 2. */}
      {disclaimer && (
        <div className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          {disclaimer}
        </div>
      )}
    </div>
  );
}
