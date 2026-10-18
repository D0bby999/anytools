-- Phase 11 (security audit F-4): server-side session revocation.
--
-- Sessions are stateless signed cookies, so nothing records that one exists.
-- This column is the watermark the BFF compares each cookie's mint time
-- (`sat`) against: a cookie minted before it is refused. Signing out bumps
-- it, which ends every copy of every session for that account — including a
-- cookie someone else copied.
ALTER TABLE users ADD COLUMN sessions_valid_after timestamptz;
