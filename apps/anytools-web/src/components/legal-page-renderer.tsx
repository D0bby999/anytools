import type { LegalPage } from '@/lib/legal-content';

export function LegalPageRenderer({ page }: { page: LegalPage }) {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 prose prose-neutral dark:prose-invert">
      <h1>{page.title}</h1>
      <p className="text-sm text-muted-foreground">Last updated: {page.lastUpdated}</p>
      {page.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.body.map((para, i) => (
            <p key={`${s.heading}-${i}`}>{para}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
