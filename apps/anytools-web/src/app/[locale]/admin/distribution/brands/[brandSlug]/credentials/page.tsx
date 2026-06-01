import { requireAdmin } from '@/lib/auth-guards';
import { type CredentialRow, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ brandSlug: string }> }): Promise<Metadata> {
  const { brandSlug } = await params;
  return { title: `Credentials — ${brandSlug} — Distribution Admin` };
}

export default async function BrandCredentialsPage({
  params,
}: { params: Promise<{ brandSlug: string; locale: string }> }) {
  const session = await requireAdmin();
  const { brandSlug, locale } = await params;

  const api = createDistributionApi({ actorEmail: session.user.email });

  // Fetch all credentials and filter client-side to this brand — the GET
  // /admin/credentials endpoint returns all brands. Brand-scoping here is a
  // display filter only; the internal API already omits encrypted token columns.
  let allCreds: CredentialRow[] | null;
  try {
    allCreds = await api.getCredentials();
  } catch {
    allCreds = null;
  }

  const creds = allCreds?.filter((c) => c.brandSlug === brandSlug) ?? null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          Credentials — <span className="font-mono capitalize">{brandSlug}</span>
        </h1>
        <Link
          href={`/${locale}/admin/distribution/brands/${brandSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← back to brand
        </Link>
      </div>

      <div className="mb-4 rounded border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        OAuth tokens are managed via the CLI tool running locally. To reconnect a platform, run{' '}
        <code className="font-mono">pnpm oauth:connect</code> from the distribution-cron directory
        and follow the prompts.
      </div>

      {!creds ? (
        <p className="text-destructive text-sm">Could not load credentials.</p>
      ) : creds.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No credentials configured for <strong>{brandSlug}</strong>.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Platform</th>
              <th className="py-2 pr-4">Account ID</th>
              <th className="py-2 pr-4">Enabled</th>
              <th className="py-2 pr-4">Consec. failures</th>
              <th className="py-2 pr-4">Last used</th>
              <th className="py-2">Last refresh</th>
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.platformId} className="border-b hover:bg-muted/30">
                <td className="py-2 pr-4 font-mono">{c.platformId}</td>
                <td className="py-2 pr-4 font-mono text-xs">{c.platformAccountId}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.enabled ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {c.enabled ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-2 pr-4 text-center">
                  <span
                    className={c.consecutiveFailures > 3 ? 'text-destructive font-semibold' : ''}
                  >
                    {c.consecutiveFailures}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">
                  {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : '—'}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {c.lastSuccessfulRefreshAt
                    ? new Date(c.lastSuccessfulRefreshAt).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
