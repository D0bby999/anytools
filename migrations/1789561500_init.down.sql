DROP TABLE IF EXISTS app_sentinel;
DROP TABLE IF EXISTS user_identities;
DROP INDEX IF EXISTS users_email_unique_live;
DROP TABLE IF EXISTS users;
-- Extensions are intentionally left installed: they are database-wide and other
-- schemas in the same database may depend on them.
