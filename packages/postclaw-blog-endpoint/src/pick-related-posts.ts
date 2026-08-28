// Which siblings the "Related reviews" block links to.
//
// The obvious implementation — same category first, then newest — makes every page
// choose the same handful of winners, because "newest" is the same list no matter
// which post is asking. Measured on the live sites 2026-08-28:
//
//                    posts   0 inbound   top receiver   Google indexed
//   besttoys.world     58       25          30 links        8 / 55
//   pettechlab.world   39        0          24 links       22 / 36
//
// Same component, opposite outcomes: besttoys is the bigger corpus, so its tail
// falls further outside every page's top-6 and 43% of it ends up with no internal
// links at all. Google's verdict on 40 of those was "Discovered - currently not
// indexed" — it knew the URLs from the sitemap and declined to fetch them.
//
// On a site with no external links, internal links are the only vote we get to
// cast. A page nothing links to reads as a page nothing vouches for, so it never
// earns the crawl. Hence a rotating window: each post starts at its own offset
// into the sibling list, which keeps the block topical while spreading in-degree
// across the whole corpus instead of pooling it on the newest few.
//
// The offset is the post's POSITION in the list, not a hash of its slug. Both
// spread the links; only position tiles them. Hashing scatters the start points
// at random, and random offsets leave gaps exactly the way random assignment
// does — a first draft of this file hashed the slug and still stranded 2 of 56
// posts with zero inbound. Walking positions makes each window start one step
// after the last, so within a category the windows cover every member the same
// number of times and "some post got unlucky" stops being possible.
//
// Ordering of `all` still matters — the caller passes it newest-first, and the
// window preserves that inside each slice. What changes is where the window starts.

export type RelatedCandidate = { slug: string; category?: string | null };

/**
 * `count` items from `items`, starting one past `fromIndex` and wrapping around,
 * skipping the anchor itself. Successive anchors therefore tile the list.
 */
function windowAfter<T>(
  items: readonly T[],
  fromIndex: number,
  count: number,
  // Undefined when the caller asks about a slug that is not in `all` — a preview
  // or a post pulled after the list was built. Nothing to skip, so nothing breaks.
  skip: T | undefined,
): T[] {
  const out: T[] = [];
  if (items.length === 0) return out;
  for (let i = 1; i <= items.length && out.length < count; i++) {
    // Modulo keeps the index in range; the undefined check is for the compiler.
    const candidate = items[(fromIndex + i) % items.length];
    if (candidate !== undefined && candidate !== skip) out.push(candidate);
  }
  return out;
}

export function pickRelatedPosts<T extends RelatedCandidate>({
  all,
  currentSlug,
  category,
  limit = 6,
  sameCategoryQuota = 4,
}: {
  all: readonly T[];
  currentSlug: string;
  category: string;
  /** Links rendered per page. */
  limit?: number;
  /** How many of those are reserved for the same category before filling from the rest. */
  sameCategoryQuota?: number;
}): T[] {
  const current = all.find((p) => p.slug === currentSlug);
  const globalIndex = current ? all.indexOf(current) : 0;

  // Same category first: strongest topical signal, and the tiling here is exact —
  // every member of a category receives `quota` links from its own siblings.
  const sameCat = all.filter((p) => (p.category ?? '') === category);
  const catIndex = current ? sameCat.indexOf(current) : 0;
  const picks = windowAfter(
    sameCat,
    catIndex < 0 ? 0 : catIndex,
    Math.min(sameCategoryQuota, limit),
    current,
  );
  const chosen = new Set(picks.map((p) => p.slug));
  chosen.add(currentSlug);

  // Fill the remaining slots from OTHER categories. Drawing from the whole corpus
  // instead would quietly overrun the quota whenever `all` happens to arrive
  // grouped by category, since the next positions would then be more siblings.
  // The offset is the post's own position in the corpus, which keeps the windows
  // walking one step at a time here too — that is what stops a post in a one-member
  // category, which the pass above cannot help, from being stranded. Counting only
  // the preceding OTHER-category posts looks more principled and is worse: when
  // `all` arrives grouped by category, every member of the leading group shares
  // offset 0 and they all point at the same two posts. Measured on the corpus in
  // the tests, that rebuilt the exact pileup this file exists to remove — 30
  // inbound links on one post.
  const rest = all.filter((p) => (p.category ?? '') !== category);
  // Scale the position into `rest`'s own index range rather than using it raw.
  // `rest` is a different length for every category, so a raw index lands unevenly:
  // the first post in `all` sits at position 0 of nearly every `rest` list, and
  // position 0 is only ever reached by an asker whose own index is 0. That is not
  // hypothetical — it stranded the newest besttoys post, the sole member of its
  // category, while every synthetic corpus in the tests passed. Scaling spreads the
  // askers evenly over `rest`, so position 0 gets its share.
  const restOffset = rest.length === 0 ? 0 : Math.floor((globalIndex * rest.length) / all.length);
  // `windowAfter` starts one past the offset; step back so position 0 is reachable.
  for (const p of windowAfter(rest, restOffset - 1, rest.length, current)) {
    if (picks.length >= limit) break;
    if (!chosen.has(p.slug)) {
      picks.push(p);
      chosen.add(p.slug);
    }
  }

  // Corpus too small to satisfy the split — top up from any sibling left over, so
  // a young site still renders a full block rather than a stub.
  for (const p of windowAfter(all, globalIndex, all.length, current)) {
    if (picks.length >= limit) break;
    if (!chosen.has(p.slug)) {
      picks.push(p);
      chosen.add(p.slug);
    }
  }
  return picks;
}
