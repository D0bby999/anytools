import { Link } from '@/i18n/routing';
import { listGuides } from '@/lib/load-guide-content';
import { Card, CardDescription, CardHeader, CardTitle } from '@anytools/ui';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const titleByLocale: Record<string, string> = {
    en: 'Guides — AnyTools',
    vi: 'Hướng dẫn — AnyTools',
    es: 'Guías — AnyTools',
    pt: 'Guias — AnyTools',
  };
  return {
    title: titleByLocale[locale] ?? titleByLocale.en,
    description: 'Deep technical guides on JSON, Regex, Encoding, and more.',
  };
}

export default async function GuidesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const guides = await listGuides(locale);
  const headings: Record<string, string> = {
    en: 'Guides',
    vi: 'Hướng dẫn',
    es: 'Guías',
    pt: 'Guias',
  };

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">{headings[locale] ?? headings.en}</h1>
      <div className="grid gap-4 sm:grid-cols-1">
        {guides.map((g) => (
          <Link key={g.slug} href={`/guides/${g.slug}` as never} className="block group">
            <Card className="hover:border-primary transition-colors">
              <CardHeader>
                <CardTitle>{g.data.title}</CardTitle>
                {g.data.description && <CardDescription>{g.data.description}</CardDescription>}
                {g.data.readingTime && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {g.data.readingTime} min read
                  </p>
                )}
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
