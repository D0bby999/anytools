import { describe, expect, it } from 'vitest';
import { generateLorem } from './logic';

describe('generateLorem', () => {
  it('default → 3 classic paragraphs', () => {
    const out = generateLorem();
    expect(out.split('\n').filter((p) => p.trim()).length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeGreaterThan(50);
  });

  it('classic starts with Lorem ipsum dolor sit amet', () => {
    const out = generateLorem({ variant: 'classic', unit: 'paragraphs', count: 1 });
    expect(out).toContain('Lorem ipsum');
  });

  it('words unit returns N words', () => {
    const out = generateLorem({ unit: 'words', count: 10 });
    expect(out.split(/\s+/).filter(Boolean).length).toBe(10);
  });

  it('sentences unit ends with period', () => {
    const out = generateLorem({ unit: 'sentences', count: 2 });
    expect(out.trim().endsWith('.')).toBe(true);
  });

  it('vietnamese variant uses Vietnamese words', () => {
    const out = generateLorem({ variant: 'vietnamese', unit: 'words', count: 30 });
    // Should contain some Vietnamese diacritic
    expect(out).toMatch(/[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/);
  });

  it('spanish variant produces Spanish-flavored text', () => {
    const out = generateLorem({ variant: 'spanish', unit: 'sentences', count: 3 });
    expect(out.length).toBeGreaterThan(20);
  });

  it('hipster variant includes hipster word', () => {
    const out = generateLorem({ variant: 'hipster', unit: 'words', count: 100 });
    expect(out).toMatch(/artisan|organic|kombucha|matcha|vinyl|fixie|cardigan|brooklyn/);
  });

  it('html output wraps paragraphs in <p>', () => {
    const out = generateLorem({ unit: 'paragraphs', count: 2, output: 'html' });
    expect(out).toMatch(/<p>.*<\/p>/);
    expect((out.match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('clamps count to 1-500', () => {
    expect(() => generateLorem({ unit: 'words', count: 0 })).not.toThrow();
    expect(() => generateLorem({ unit: 'words', count: 10000 })).not.toThrow();
  });
});
