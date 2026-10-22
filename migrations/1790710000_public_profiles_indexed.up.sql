-- 1790710000_public_profiles_indexed — a public profile may be listed by
-- search engines (owner, 2026-10-22). Only a published page with `indexed`
-- is in the sitemap and drops `noindex`; the editor ticks it for a new page,
-- and the learner can untick it.

ALTER TABLE public_profiles ADD COLUMN indexed boolean NOT NULL DEFAULT false;

-- The sitemap reads published, indexed pages, newest change first.
CREATE INDEX public_profiles_indexed ON public_profiles (updated_at DESC) WHERE published AND indexed;
