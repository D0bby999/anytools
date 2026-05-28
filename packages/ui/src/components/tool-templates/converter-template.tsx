'use client';
import { Button } from '../button';
import { ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  description?: string;
  /** Left input pane (source) */
  source: ReactNode;
  /** Right output pane (target) */
  target: ReactNode;
  onSwap?: () => void;
  actions?: ReactNode;
  disclaimer?: ReactNode;
};

/**
 * Dual-pane converter. Source ↔ Target with optional swap button.
 * Unit converter, currency, temperature, etc.
 */
export function ConverterTemplate({
  title,
  description,
  source,
  target,
  onSwap,
  actions,
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
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 md:gap-4 items-stretch">
        <div className="space-y-3">{source}</div>
        {onSwap ? (
          <div className="flex justify-center md:items-center md:px-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onSwap}
              aria-label="Swap units"
              className="h-11 w-11 md:rotate-0 rotate-90"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="hidden md:block" />
        )}
        <div className="space-y-3">{target}</div>
      </div>
      {actions && <div className="flex items-center gap-2 justify-end">{actions}</div>}
      {disclaimer && (
        <p className="text-xs text-muted-foreground border-t pt-4 leading-relaxed">{disclaimer}</p>
      )}
    </div>
  );
}
