/**
 * JSON-LD schema markup helpers for SEO.
 * Use in tool pages: <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(schema) }} />
 *
 * Deliberately absent: `HowTo`. Google removed HowTo rich results in September 2023,
 * so the block was dead weight on every tool page with a tutorial (SEO audit
 * 2026-09-05). `FAQPage` stays — its rich result retired on 2026-05-07 too, but the
 * markup still describes real on-page Q&A and costs nothing.
 */

import type { ClusterId } from '@anytools/tools/types';
import { GITHUB_REPO_URL } from './site-url';

/**
 * Serialize a schema object as JSON-LD and escape `</` to prevent
 * an attacker (or arbitrary description text) from breaking out of the script tag.
 */
export function jsonLdSafe(schema: object): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

/**
 * Schema.org `applicationCategory` per cluster. The value used to be a single
 * hard-coded `DeveloperApplication`, which told Google a BMI calculator and a
 * mortgage calculator were developer tools. Clusters not listed here fall back to
 * `UtilitiesApplication`, the least wrong default for a generic converter.
 */
const APPLICATION_CATEGORY: Partial<Record<ClusterId, string>> = {
  encoding: 'DeveloperApplication',
  formatters: 'DeveloperApplication',
  generators: 'DeveloperApplication',
  'text-regex': 'DeveloperApplication',
  web3: 'DeveloperApplication',
  converters: 'UtilitiesApplication',
  'time-date': 'UtilitiesApplication',
  pdf: 'UtilitiesApplication',
  image: 'MultimediaApplication',
  design: 'DesignApplication',
  finance: 'FinanceApplication',
  health: 'HealthApplication',
  lifestyle: 'LifestyleApplication',
  marketing: 'BusinessApplication',
  'ecommerce-vn': 'BusinessApplication',
};

export function applicationCategory(cluster: string): string {
  return APPLICATION_CATEGORY[cluster as ClusterId] ?? 'UtilitiesApplication';
}

export const softwareAppSchema = (input: {
  name: string;
  description: string;
  url: string;
  cluster: string;
  locale: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: input.name,
  applicationCategory: applicationCategory(input.cluster),
  operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  inLanguage: input.locale,
  description: input.description,
  url: input.url,
});

/**
 * Site-wide entity graph, emitted once per locale from the locale layout.
 *
 * Before 2026-09-05 no page carried a WebSite or Organization node, so nothing tied
 * "AnyTools" the brand to its GitHub repository or told Google the catalog search box
 * exists. `SearchAction.target` points at the homepage `?q=` filter, which
 * tool-catalog.tsx already reads.
 */
export const siteSchema = (input: { siteUrl: string; locale: string }) => {
  const website = {
    '@type': 'WebSite',
    '@id': `${input.siteUrl}/#website`,
    url: `${input.siteUrl}/${input.locale}`,
    name: 'AnyTools',
    inLanguage: input.locale,
    publisher: { '@id': `${input.siteUrl}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${input.siteUrl}/${input.locale}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
  const organization = {
    '@type': 'Organization',
    '@id': `${input.siteUrl}/#organization`,
    name: 'AnyTools',
    url: input.siteUrl,
    logo: `${input.siteUrl}/icons/icon-512.png`,
    sameAs: [GITHUB_REPO_URL],
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [website, organization] as [typeof website, typeof organization],
  };
};

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
