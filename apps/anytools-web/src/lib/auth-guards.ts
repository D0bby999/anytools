import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';

// Admin email allowlist: comma-separated list of lowercase email addresses.
// Set DISTRIBUTION_ADMIN_EMAILS in Coolify env, e.g.:
//   DISTRIBUTION_ADMIN_EMAILS=alice@example.com,bob@example.com
//
// Why env-var instead of a DB column: the auth DB is a local SQLite file
// (better-sqlite3) that is ephemeral in containerised deployments. A persisted
// column would be wiped on every redeploy unless a volume is mounted. The
// allowlist is a configuration concern, not user data — env vars are the right
// primitive here.
const ADMIN_EMAILS: ReadonlySet<string> = new Set(
  (process.env.DISTRIBUTION_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Asserts the current request is made by an authenticated admin user.
 *
 * Call this at the TOP of every `/admin/distribution` layout, page, and server
 * action BEFORE reading any input or query params. If the session is absent or
 * the email is not in the allowlist the user is redirected to sign-in — no
 * error is thrown, so the caller's rendering is simply halted.
 *
 * Returns the verified session so callers can read `session.user.email` without
 * re-fetching.
 *
 * Why no middleware: Better Auth's `getSession()` calls the native better-sqlite3
 * binding which cannot run in the Next.js Edge runtime that middleware uses.
 * Per-layout/per-action guards are equivalent in security because Next.js App
 * Router always runs layouts before pages and actions are server-only.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.email || !ADMIN_EMAILS.has(session.user.email.toLowerCase())) {
    redirect('/sign-in?next=/admin/distribution');
  }

  // TypeScript narrowing: after the redirect guard above, session and user are
  // definitely present and the email is allowlisted.
  return session as NonNullable<typeof session>;
}
