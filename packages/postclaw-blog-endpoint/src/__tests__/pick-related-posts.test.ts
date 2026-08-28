import { describe, expect, it } from 'vitest';
import { pickRelatedPosts } from '../pick-related-posts';

// The besttoys.world corpus as it actually is (2026-08-28): 56 posts in real
// publish order, newest first — the order the component receives them in.
//
// Both the skew and the ORDER carry the bugs. One category holds nearly half the
// site, so "newest 6 in this category" strands 20 of its own members. And the
// newest post is the sole member of its category, which is what stranded a live
// post after the orphan count had already reached zero on every tidy synthetic
// corpus. Generated fixtures kept agreeing with the code; only the real sequence
// disagreed, so the real sequence is the fixture.
const CATEGORY_ORDER = [
  'creative-toys',
  'stem-kits',
  'robotics',
  'stem-toys',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'robotics',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'programming-toys',
  'electronic-learning',
  'electronics',
  'programming-toys',
  'programming-toys',
  'electronics',
  'electronics',
  'stem-kits',
  'robotics',
  'programming',
  'robotics',
  'robotics',
  'programming-toys',
  'electronic-learning',
  'robotics',
  'programming-toys',
  'programming-toys',
  'robotics',
  'robotics',
  'robotics',
  'robotics',
  'robotics',
  'electronic-learning',
  'electronic-learning',
  'stem-kits',
  'stem-kits',
  'programming-toys',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'stem-kits',
  'robotics',
  'robotics',
  'stem-kits',
  'stem-kits',
];

type Post = { slug: string; category: string };

function realisticCorpus(): Post[] {
  return CATEGORY_ORDER.map((category, i) => ({ slug: `${category}-${i}`, category }));
}

/** In-degree every post receives once the whole corpus has rendered its block. */
function inboundCounts(all: Post[], pick: (all: Post[], p: Post) => Post[]) {
  const inbound = new Map(all.map((p) => [p.slug, 0]));
  for (const post of all) {
    for (const target of pick(all, post)) {
      inbound.set(target.slug, (inbound.get(target.slug) ?? 0) + 1);
    }
  }
  return inbound;
}

const rotating = (all: Post[], p: Post) =>
  pickRelatedPosts({ all, currentSlug: p.slug, category: p.category });

/** What the block used to do: same category first, then the rest, always newest-first. */
const newestFirst = (all: Post[], p: Post) => {
  const others = all.filter((o) => o.slug !== p.slug);
  const same = others.filter((o) => o.category === p.category);
  const rest = others.filter((o) => o.category !== p.category);
  return [...same, ...rest].slice(0, 6);
};

describe('pickRelatedPosts — crawl reachability', () => {
  it('leaves no post without inbound internal links', () => {
    const all = realisticCorpus();
    const orphans = [...inboundCounts(all, rotating)].filter(([, n]) => n === 0);
    expect(orphans).toEqual([]);
  });

  // One corpus passing proves nothing — the first draft of this file offset the
  // window by a hash of the slug, passed the case above, and still stranded two
  // posts once the slugs were renamed. Reachability has to hold for the shape of
  // the corpus, not for one lucky set of names.
  it.each([
    ['flat', { a: 10, b: 10, c: 10 }],
    ['one dominant category', { big: 40, small: 3, tiny: 1 }],
    ['all singletons', { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1 }],
    ['two posts', { a: 1, b: 1 }],
    ['a category smaller than its quota', { a: 2, b: 2, c: 30 }],
  ])('leaves no orphan in a %s corpus', (_name, sizes) => {
    const all: Post[] = [];
    for (const [category, n] of Object.entries(sizes)) {
      for (let i = 0; i < n; i++) all.push({ slug: `${category}${i}`, category });
    }
    const orphans = [...inboundCounts(all, rotating)]
      .filter(([, n]) => n === 0)
      .map(([slug]) => slug);
    expect(orphans).toEqual([]);
  });

  it('gives every member of a category the same number of same-category links', () => {
    const all = realisticCorpus();
    const fromOwnCategory = new Map(all.map((p) => [p.slug, 0]));
    for (const post of all) {
      for (const t of rotating(all, post)) {
        if (t.category === post.category) {
          fromOwnCategory.set(t.slug, (fromOwnCategory.get(t.slug) ?? 0) + 1);
        }
      }
    }
    // 26 siblings, 4 reserved slots, windows walking one position at a time: each
    // post is inside exactly 4 of its category's windows. Exactness is the reason
    // to offset by position rather than by hash.
    const stemKits = all.filter((p) => p.category === 'stem-kits');
    expect(stemKits.map((p) => fromOwnCategory.get(p.slug))).toEqual(stemKits.map(() => 4));
  });

  // Guards the test itself: if this ever passes, the assertion above has stopped
  // measuring anything. The shipped bug must remain detectable by this corpus.
  it('detects the newest-first algorithm it replaced', () => {
    const all = realisticCorpus();
    const orphans = [...inboundCounts(all, newestFirst)].filter(([, n]) => n === 0);
    expect(orphans.length).toBeGreaterThan(20);
  });

  it('spreads in-degree instead of pooling it on a few winners', () => {
    const all = realisticCorpus();
    const counts = [...inboundCounts(all, rotating).values()];
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Every page emits 6 links, so the mean is 6 by construction; the claim worth
    // asserting is that no page hoards. The old code peaked at 30 against a mean of 6.
    expect(Math.max(...counts)).toBeLessThanOrEqual(mean * 3);
  });

  it('reaches every post in an oversized category', () => {
    const all = realisticCorpus();
    const inbound = inboundCounts(all, rotating);
    const biggest = all.filter((p) => p.category === 'stem-kits');
    expect(biggest.every((p) => (inbound.get(p.slug) ?? 0) > 0)).toBe(true);
  });
});

describe('pickRelatedPosts — block contract', () => {
  const all = realisticCorpus();

  it('is deterministic for the same input', () => {
    const a = pickRelatedPosts({ all, currentSlug: 'robotics-2', category: 'robotics' });
    const b = pickRelatedPosts({ all, currentSlug: 'robotics-2', category: 'robotics' });
    expect(a.map((p) => p.slug)).toEqual(b.map((p) => p.slug));
  });

  it('never links a post to itself', () => {
    for (const p of all) {
      expect(rotating(all, p).map((x) => x.slug)).not.toContain(p.slug);
    }
  });

  it('renders exactly `limit` links whenever the corpus can supply them', () => {
    for (const p of all) expect(rotating(all, p)).toHaveLength(6);
  });

  it('emits no duplicates', () => {
    for (const p of all) {
      const slugs = rotating(all, p).map((x) => x.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('keeps the block topical — same-category links fill the reserved quota', () => {
    const picks = pickRelatedPosts({
      all,
      currentSlug: 'stem-kits-1',
      category: 'stem-kits',
    });
    expect(picks.filter((p) => p.category === 'stem-kits')).toHaveLength(4);
  });

  it('falls back to other categories when a post is the only one in its own', () => {
    const picks = pickRelatedPosts({
      all,
      currentSlug: 'programming-29',
      category: 'programming',
    });
    expect(picks).toHaveLength(6);
    expect(picks.every((p) => p.category !== 'programming')).toBe(true);
  });

  it('returns what it can when the corpus is smaller than the limit', () => {
    const tiny: Post[] = [
      { slug: 'a', category: 'x' },
      { slug: 'b', category: 'x' },
      { slug: 'c', category: 'y' },
    ];
    expect(pickRelatedPosts({ all: tiny, currentSlug: 'a', category: 'x' })).toHaveLength(2);
  });

  it('returns nothing for a single-post site', () => {
    expect(
      pickRelatedPosts({
        all: [{ slug: 'only', category: 'x' }],
        currentSlug: 'only',
        category: 'x',
      }),
    ).toEqual([]);
  });

  it('treats a missing category as its own bucket rather than crashing', () => {
    const mixed = [
      { slug: 'a', category: undefined },
      { slug: 'b', category: null },
      { slug: 'c', category: 'x' },
    ];
    const picks = pickRelatedPosts({ all: mixed, currentSlug: 'a', category: '' });
    expect(picks.map((p) => p.slug).sort()).toEqual(['b', 'c']);
  });
});
