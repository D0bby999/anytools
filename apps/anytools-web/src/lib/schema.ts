/**
 * JSON-LD schema markup helpers for SEO.
 * Use in tool pages: <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(schema) }} />
 */

/**
 * Serialize a schema object as JSON-LD and escape `</` to prevent
 * an attacker (or arbitrary description text) from breaking out of the script tag.
 */
export function jsonLdSafe(schema: object): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

export const softwareAppSchema = (input: { name: string; description: string; url: string }) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: input.name,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description: input.description,
  url: input.url,
});

export const howToSchema = (input: { name: string; steps: { name: string; text: string }[] }) => ({
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: input.name,
  step: input.steps.map((s, i) => ({
    '@type': 'HowToStep',
    position: i + 1,
    name: s.name,
    text: s.text,
  })),
});

/**
 * Breadcrumb trail for a page.
 *
 * `item` must be the absolute canonical URL of each step — Google compares the trail
 * against the canonical, and a mismatched or relative href makes it drop the breadcrumb
 * silently. Callers build the URLs from the same SITE_URL + locale path the canonical
 * tag uses, so the two cannot drift apart.
 */
export const breadcrumbSchema = (trail: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((step, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: step.name,
    item: step.url,
  })),
});

export const faqSchema = (qa: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: qa.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});
