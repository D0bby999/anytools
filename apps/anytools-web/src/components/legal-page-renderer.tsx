import type { LegalPage } from '@/lib/legal-content';
import type { ReactNode } from 'react';

// Bare URLs are written inline in legal-content.ts (plain strings, no markup) and turned
// into real links here. Google's AdSense programme policies require the privacy policy to
// point users at the personalised-ads opt-out; a URL nobody can click does not do that.
// Trailing punctuation is excluded so a sentence-ending period stays out of the href.
const URL_PATTERN = /(https?:\/\/[^\s]+?)(?=[.,;:]?(?:\s|$))/g;

function linkify(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    const url = m[1];
    if (url === undefined) continue;
    const start = m.index;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a key={`${keyPrefix}-${start}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function LegalPageRenderer({ page }: { page: LegalPage }) {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 prose prose-neutral dark:prose-invert">
      <h1>{page.title}</h1>
      <p className="text-sm text-muted-foreground">Last updated: {page.lastUpdated}</p>
      {page.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.body.map((para, i) => (
            <p key={`${s.heading}-${i}`}>{linkify(para, `${s.heading}-${i}`)}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
