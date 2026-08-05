import { Link } from '@/i18n/routing';
import { toolMetasClient } from '@anytools/tools/meta';
import type { ClusterId, SupportedLocale } from '@anytools/tools/types';

export interface RelatedToolsProps {
  cluster: ClusterId;
  currentSlug: string;
  locale: string;
  /** Cap the list so the section stays scannable rather than a link dump. */
  limit?: number;
}

/**
 * Sibling tools from the same cluster.
 *
 * Why this is not just WorkflowChain: that component only renders when a tool
 * author hand-wrote `nextStepSuggestions`, so most tools link to nothing and
 * some well-performing pages had no inbound internal link at all except the
 * homepage grid (binary-encode was the site's highest-impression URL and sat at
 * position ~37 with exactly one inbound link). Deriving siblings from the
 * cluster gives every tool a dense, always-present set of topically-related
 * inbound and outbound links with no per-tool configuration to maintain.
 *
 * Excludes unpublished tools and tools that do not support the current locale,
 * so we never advertise a URL that 404s or falls back to another language.
 */
export function RelatedTools({ cluster, currentSlug, locale, limit = 6 }: RelatedToolsProps) {
  const siblings = toolMetasClient
    .filter(
      (m) =>
        m.cluster === cluster &&
        m.slug !== currentSlug &&
        m.published !== false &&
        (!m.availableLocales || m.availableLocales.includes(locale as SupportedLocale)),
    )
    .slice(0, limit);

  if (siblings.length === 0) return null;

  return (
    <section aria-label="Related tools" className="mt-8">
      <h2 className="text-xl font-semibold mb-4">More {cluster.replace(/-/g, ' ')} tools</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {siblings.map((m) => {
          const title = m.title[locale] ?? m.title.en ?? m.slug;
          const desc = m.description[locale] ?? m.description.en ?? '';
          return (
            <li key={m.slug}>
              <Link
                href={`/${m.cluster}/${m.slug}` as never}
                className="text-sm text-primary hover:underline"
              >
                {title}
              </Link>
              {desc && (
                <span className="text-sm text-muted-foreground"> — {desc.split('.')[0]}.</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
