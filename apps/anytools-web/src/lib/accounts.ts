/**
 * Accounts are switched off on every build, hosted included: /sign-in, /sign-up,
 * /dashboard, /admin/distribution and /api/auth/** all 404 before anything imports
 * better-auth, and requireAdmin() throws.
 *
 * Why: nobody ever registered (the production auth.db had no tables at all on
 * 2026-09-26), DISTRIBUTION_ADMIN_EMAILS was never set so the admin area was
 * unreachable anyway, and the privacy page no longer describes account data. Keeping
 * live-but-broken sign-up pages only invited GDPR deletion requests for data we never held.
 *
 * To bring accounts back on the hosted site, set this to `IS_SELF_HOSTED` (from
 * ./self-hosted) — self-host must stay disabled — and restore the account section of
 * the privacy page. Typed `boolean`, not the literal `true`, so the code after each
 * gate is not flagged unreachable.
 */
export const ACCOUNTS_DISABLED: boolean = true;
