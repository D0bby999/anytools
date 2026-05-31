import { describe, expect, it } from 'vitest';
import { faqSchema, howToSchema, jsonLdSafe, softwareAppSchema } from './schema';

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
    });
    expect(out['@type']).toBe('SoftwareApplication');
    expect(out['@context']).toBe('https://schema.org');
    expect(out.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    expect(out.url).toContain('bmi-calculator');
  });
});

describe('howToSchema', () => {
  it('numbers steps sequentially starting at 1', () => {
    const out = howToSchema({
      name: 'How to BMI',
      steps: [
        { name: 'Input weight', text: 'Enter kg' },
        { name: 'Input height', text: 'Enter cm' },
      ],
    });
    expect(out.step).toHaveLength(2);
    expect(out.step[0]).toEqual({
      '@type': 'HowToStep',
      position: 1,
      name: 'Input weight',
      text: 'Enter kg',
    });
    expect(out.step[1]?.position).toBe(2);
  });

  it('handles empty step list', () => {
    const out = howToSchema({ name: 'X', steps: [] });
    expect(out.step).toEqual([]);
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
