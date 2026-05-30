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

export const faqSchema = (qa: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: qa.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});
