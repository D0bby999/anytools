-- Local review: a development-only identity provider.
--
-- `local` lets the owner sign in on their own machine before any Google or
-- GitHub OAuth app exists. The API accepts it only when LONGPLAY_ENV is
-- exactly `development` (internal/auth), and the BFF only offers it on a
-- localhost app URL with LONGPLAY_DEV_LOGIN=1; the column merely allows it.
ALTER TABLE user_identities DROP CONSTRAINT user_identities_provider_known;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_known
    CHECK (provider IN ('google', 'github', 'local'));
