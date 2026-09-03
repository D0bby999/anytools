import { Link } from '@/i18n/routing';
import { toolMetasClient } from '@anytools/tools/meta';
import type { NextStepSuggestion } from '@anytools/tools/types';
import { Card, CardDescription, CardHeader, CardTitle } from '@anytools/ui';
import { ArrowRight } from 'lucide-react';

export interface WorkflowChainProps {
  suggestions: NextStepSuggestion[];
  locale: string;
  heading?: string;
}

export function WorkflowChain({ suggestions, locale, heading = 'What next?' }: WorkflowChainProps) {
  if (suggestions.length === 0) return null;

  const enriched = suggestions
    .map((s) => {
      const m = toolMetasClient.find((mm) => mm.slug === s.tool);
      if (!m) return null;
      // A tool that renders in English only 404s on every other locale, so a suggestion
      // pointing at one from a translated page would be a dead link in three languages.
      if (m.availableLocales && !(m.availableLocales as readonly string[]).includes(locale)) {
        return null;
      }
      return {
        slug: m.slug,
        cluster: m.cluster,
        title: m.title[locale] ?? m.title.en ?? m.slug,
        reason: s.reason[locale] ?? s.reason.en ?? '',
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (enriched.length === 0) return null;

  return (
    <section aria-label="Workflow suggestions" className="mt-8">
      <h2 className="text-xl font-semibold mb-4">{heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {enriched.map((item) => (
          <Link
            key={`${item.cluster}/${item.slug}`}
            href={`/${item.cluster}/${item.slug}` as never}
            className="block group"
          >
            <Card className="hover:border-primary transition-colors">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>{item.title}</span>
                  <ArrowRight className="h-4 w-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
                </CardTitle>
                <CardDescription>{item.reason}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
