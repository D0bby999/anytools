DELETE FROM user_identities WHERE provider = 'local';
ALTER TABLE user_identities DROP CONSTRAINT user_identities_provider_known;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_known
    CHECK (provider IN ('google', 'github'));
