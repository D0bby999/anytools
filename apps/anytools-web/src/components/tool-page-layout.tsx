import { Link } from '@/i18n/routing';
import type { ToolContent } from '@/lib/load-tool-content';
import type { ToolMeta } from '@anytools/tools/types';
import type { ReactNode } from 'react';
import { AdSlot } from './ad-slot';
import { FaqSection } from './faq-section';
import { RelatedTools } from './related-tools';
import { ToolToolbar } from './tool-toolbar';
import { TrackToolVisit } from './track-tool-visit';
import { TutorialSection } from './tutorial-section';
import { WorkflowChain } from './workflow-chain';

export interface ToolPageLayoutProps {
  meta: ToolMeta;
  locale: string;
  content: ToolContent;
  children: ReactNode;
}

export function ToolPageLayout({ meta, locale, content, children }: ToolPageLayoutProps) {
  const title = meta.title[locale] ?? meta.title.en ?? meta.slug;
  const description = meta.description[locale] ?? meta.description.en ?? '';
  const hasTutorial = Boolean(content.tutorial);
  const hasFaq = Boolean(content.faq && content.faq.items.length > 0);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-4">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>{meta.cluster}</span>
        <span className="mx-2">/</span>
        <span className="text-foreground">{title}</span>
      </nav>
      <header className="mb-4">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>
      <ToolToolbar
        slug={meta.slug}
        cluster={meta.cluster}
        hasTutorial={hasTutorial}
        hasFaq={hasFaq}
      />
      <TrackToolVisit slug={meta.slug} cluster={meta.cluster} />
      <section id="tool" className="mt-6 scroll-mt-32">
        {children}
      </section>
      <WorkflowChain suggestions={meta.nextStepSuggestions ?? []} locale={locale} />
      <div className="my-8">
        <AdSlot slotId="tool-page-end" format="horizontal" />
      </div>
      {hasTutorial && (
        <section id="tutorial" className="scroll-mt-32">
          {content.tutorial && <TutorialSection source={content.tutorial.source} />}
        </section>
      )}
      {hasFaq && (
        <section id="faq" className="scroll-mt-32">
          {content.faq && <FaqSection source={content.faq.source} />}
        </section>
      )}
      <RelatedTools cluster={meta.cluster} currentSlug={meta.slug} locale={locale} />
      <div className="my-8">
        <AdSlot slotId="tool-page-bottom" format="auto" />
      </div>
    </main>
  );
}
