'use client';
import { ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStrings } from '../../i18n/ui-strings';
import { Button } from '../button';

type Props = {
  title?: string;
  description?: string;
  /**
   * Controls that apply to the whole conversion — mode, indent width, "Try example".
   * Sits above both panes, because it governs both. Added in Phase 2 of the UI upgrade:
   * every beautifier and formatter has such a row, and without a slot each was hand-rolling
   * one inside its own `source` pane, where it read as an input-only option.
   */
  toolbar?: ReactNode;
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
  toolbar,
  source,
  target,
  onSwap,
  actions,
  disclaimer,
}: Props) {
  const s = useUiStrings();
  return (
    <div className="space-y-6">
      {(title || description) && (
        <header>
          {title && <h2 className="text-2xl font-semibold mb-1">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      {toolbar && <div className="flex flex-wrap items-end gap-3">{toolbar}</div>}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 md:gap-4 items-stretch">
        <div className="space-y-3">{source}</div>
        {onSwap ? (
          <div className="flex justify-center md:items-center md:px-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onSwap}
              aria-label={s.swapUnits}
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
