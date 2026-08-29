/**
 * BlogHero must tolerate hero images without a credit block.
 *
 * PostClaw-ingested posts (map-postclaw-payload.ts) intentionally store
 * heroImage as { url, alt } with NO credit — rendering the caption for them
 * used to throw (`credit.kind` on undefined) and 500 every PostClaw post
 * that carried a cover image, while git-MDX posts (full credit) rendered fine.
 */
import type { BlogHeroImage } from '@/lib/load-blog-content';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlogHero } from './blog-hero';

const render = (image: BlogHeroImage) => renderToStaticMarkup(createElement(BlogHero, { image }));

describe('BlogHero', () => {
  it('renders a PostClaw hero (no credit block) without throwing, and omits the caption', () => {
    // Exact shape written by mapPayloadToBlogInsert for cover_image_url posts.
    const image = {
      url: 'https://img.anytools.world/anytools/blog/gpa.jpg',
      alt: 'GPA calculator vs spreadsheet',
    } as BlogHeroImage;

    const html = render(image);
    expect(html).toContain('img');
    expect(html).not.toContain('figcaption');
  });

  it('omits the caption when credit exists but has no photographer and is not AI', () => {
    const image: BlogHeroImage = {
      url: 'https://example.com/x.jpg',
      alt: 'x',
      credit: {} as BlogHeroImage['credit'],
    };
    expect(render(image)).not.toContain('figcaption');
  });

  it('renders the Unsplash caption when photographer credit is present', () => {
    const image: BlogHeroImage = {
      url: 'https://example.com/x.jpg',
      alt: 'x',
      credit: {
        photographer: 'Jane Doe',
        photographer_url: 'https://unsplash.com/@jane',
        unsplash_url: 'https://unsplash.com/photos/abc',
      },
    };
    const html = render(image);
    expect(html).toContain('figcaption');
    expect(html).toContain('Jane Doe');
  });

  it('renders the AI caption for kind=ai credits', () => {
    const image: BlogHeroImage = {
      url: 'https://example.com/x.jpg',
      alt: 'x',
      credit: { photographer: '', kind: 'ai', source_label: 'AI illustration' },
    };
    const html = render(image);
    expect(html).toContain('figcaption');
    expect(html).toContain('AI illustration');
  });
});
