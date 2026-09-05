import { describe, expect, it } from 'vitest';
import {
  applicationCategory,
  faqSchema,
  jsonLdSafe,
  siteSchema,
  softwareAppSchema,
} from './schema';

describe('jsonLdSafe (XSS guard)', () => {
  it('escapes </script> closer so attacker cannot break out', () => {
    const schema = { description: 'Hello </script><img onerror=alert(1) src=x>' };
    const out = jsonLdSafe(schema);
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
  });

  it('escapes lone < anywhere in payload', () => {
    const schema = { html: '<div>' };
    expect(jsonLdSafe(schema)).toBe('{"html":"\\u003cdiv>"}');
  });

  it('passes safe payloads through unchanged (no <)', () => {
    const schema = { name: 'AnyTools', n: 42 };
    expect(jsonLdSafe(schema)).toBe('{"name":"AnyTools","n":42}');
  });

  it('produces valid JSON after escape', () => {
    const schema = { a: 'x </script> y', b: ['<', '<<<'] };
    const escaped = jsonLdSafe(schema);
    // Browser-side JSON.parse must succeed
    expect(() => JSON.parse(escaped)).not.toThrow();
    expect(JSON.parse(escaped)).toEqual(schema);
  });

  it('handles nested objects with < in deep keys', () => {
    const schema = { outer: { inner: '<bad>' } };
    expect(jsonLdSafe(schema)).toBe('{"outer":{"inner":"\\u003cbad>"}}');
  });
});

describe('softwareAppSchema', () => {
  it('produces Schema.org SoftwareApplication shape', () => {
    const out = softwareAppSchema({
      name: 'BMI Calculator',
      description: 'Free BMI calculator',
      url: 'https://anytools.world/en/health/bmi-calculator',
      cluster: 'health',
      locale: 'en',
    });
    expect(out['@type']).toBe('SoftwareApplication');
    expect(out['@context']).toBe('https://schema.org');
    expect(out.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    expect(out.url).toContain('bmi-calculator');
    expect(out.inLanguage).toBe('en');
  });

  it('derives applicationCategory from the cluster instead of calling every tool a dev tool', () => {
    expect(applicationCategory('health')).toBe('HealthApplication');
    expect(applicationCategory('finance')).toBe('FinanceApplication');
    expect(applicationCategory('formatters')).toBe('DeveloperApplication');
    expect(applicationCategory('pdf')).toBe('UtilitiesApplication');
    // Unknown cluster ids fall back rather than throwing at render time.
    expect(applicationCategory('not-a-cluster')).toBe('UtilitiesApplication');
  });
});

describe('siteSchema', () => {
  it('links WebSite to Organization and exposes the ?q= catalog search', () => {
    const out = siteSchema({ siteUrl: 'https://anytools.world', locale: 'vi' });
    const [site, org] = out['@graph'];
    expect(site['@type']).toBe('WebSite');
    expect(site.url).toBe('https://anytools.world/vi');
    expect(site.inLanguage).toBe('vi');
    expect(site.publisher).toEqual({ '@id': 'https://anytools.world/#organization' });
    expect(site.potentialAction?.target.urlTemplate).toBe(
      'https://anytools.world/vi?q={search_term_string}',
    );
    expect(org['@type']).toBe('Organization');
    expect(org['@id']).toBe('https://anytools.world/#organization');
    expect(org.sameAs).toEqual(['https://github.com/D0bby999/anytools']);
  });

  it('has no HowTo anywhere in the graph (rich result removed 2023)', () => {
    expect(jsonLdSafe(siteSchema({ siteUrl: 'https://x.test', locale: 'en' }))).not.toContain(
      'HowTo',
    );
  });
});

describe('faqSchema', () => {
  it('shapes Q/A pairs into Schema.org FAQPage', () => {
    const out = faqSchema([
      { q: 'What is BMI?', a: 'Body Mass Index' },
      { q: 'Is it accurate?', a: 'Screening only' },
    ]);
    expect(out['@type']).toBe('FAQPage');
    expect(out.mainEntity).toHaveLength(2);
    expect(out.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'What is BMI?',
      acceptedAnswer: { '@type': 'Answer', text: 'Body Mass Index' },
    });
  });
});
