'use client';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../button';
import { CopyButton } from '../copy-button';

type Props = {
  title?: string;
  description?: string;
  /** Form / config inputs */
  form: ReactNode;
  /** Generated output (string) — wires copy-to-clipboard */
  output: string;
  /** Display element for the output (e.g. <pre>{output}</pre>) */
  outputDisplay: ReactNode;
  /** Required: an untranslated default here ships literal English into vi/es/pt pages. */
  primaryActionLabel: string;
  /**
   * Omit for generators that recompute as you type. The button is then not rendered at all —
   * a disabled or no-op "Generate" on a live tool is a control that lies about what it does.
   */
  onGenerate?: () => void;
  /** Required, same reason as primaryActionLabel. `ui.output` is already translated. */
  outputLabel: string;
};

/**
 * Form → output flow. Inputs at top, generate button, then output card with copy-to-clipboard.
 *
 * Written before any tool used it and left with zero consumers for months. Adopted in Phase 1
 * of the UI upgrade rather than deleted, because it is the right shape for the generators
 * cluster it was named after — but `onGenerate` had to become optional first, since several
 * generators recompute live and had no button to give it.
 */
export function GeneratorTemplate({
  title,
  description,
  form,
  output,
  outputDisplay,
  primaryActionLabel,
  onGenerate,
  outputLabel,
}: Props) {
  return (
    <div className="space-y-6">
      {(title || description) && (
        <header>
          {title && <h2 className="text-2xl font-semibold mb-1">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      <section className="space-y-3">{form}</section>
      {onGenerate && (
        <Button type="button" size="lg" onClick={onGenerate} className="w-full h-12">
          <Sparkles className="h-4 w-4 mr-2" />
          {primaryActionLabel}
        </Button>
      )}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/30">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {outputLabel}
          </span>
          {output && <CopyButton text={output} />}
        </div>
        <div className="p-4">{outputDisplay}</div>
      </section>
    </div>
  );
}
