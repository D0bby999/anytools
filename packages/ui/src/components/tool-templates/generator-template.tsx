'use client';
import { Button } from '../button';
import { CopyButton } from '../copy-button';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  description?: string;
  /** Form / config inputs */
  form: ReactNode;
  /** Generated output (string) — wires copy-to-clipboard */
  output: string;
  /** Display element for the output (e.g. <pre>{output}</pre>) */
  outputDisplay: ReactNode;
  primaryActionLabel?: string;
  onGenerate: () => void;
  outputLabel?: string;
};

/**
 * Form → output flow. Inputs at top, generate button, then output card
 * with copy-to-clipboard. UUID, lorem ipsum, slugify, etc.
 */
export function GeneratorTemplate({
  title,
  description,
  form,
  output,
  outputDisplay,
  primaryActionLabel = 'Generate',
  onGenerate,
  outputLabel = 'Output',
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
      <Button type="button" size="lg" onClick={onGenerate} className="w-full h-12">
        <Sparkles className="h-4 w-4 mr-2" />
        {primaryActionLabel}
      </Button>
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
