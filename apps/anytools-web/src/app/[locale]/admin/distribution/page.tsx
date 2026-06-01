import { requireAdmin } from '@/lib/auth-guards';
import { type DashboardData, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Distribution Dashboard — Admin' };

export default async function DistributionDashboardPage() {
  const session = await requireAdmin();
  const api = createDistributionApi({ actorEmail: session.user.email });

  let data: DashboardData | null;
  try {
    data = await api.getDashboard({ days: 7 });
  } catch {
    data = null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Distribution Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-8">Last 7 days — all brands</p>

      {!data ? (
        <p className="text-destructive text-sm">
          Could not load dashboard data. Is distribution-cron reachable?
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {data.brands.map((b) => {
              const successRate = b.total > 0 ? Math.round((b.posted / b.total) * 100) : 0;
              return (
                <div key={b.brandSlug} className="rounded-lg border bg-card p-5 space-y-2">
                  <div className="font-semibold capitalize">{b.brandSlug}</div>
                  <div className="text-3xl font-bold">{b.total}</div>
                  <div className="text-xs text-muted-foreground">posts queued</div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-600">{b.posted} posted</span>
                    <span className="text-destructive">{b.failed} failed</span>
                    <span className="ml-auto font-medium">{successRate}% ok</span>
                  </div>
                  <a
                    href={`brands/${b.brandSlug}/posts`}
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    View posts →
                  </a>
                </div>
              );
            })}
          </section>

          {data.top_pins.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Top Pins by Clicks</h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Brand</th>
                    <th className="py-2 pr-4">Clicks</th>
                    <th className="py-2">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_pins.map((p) => (
                    <tr key={p.postId} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-4 capitalize">{p.brandSlug}</td>
                      <td className="py-2 pr-4 font-mono">{p.clicks}</td>
                      <td className="py-2">
                        {p.platformPostUrl ? (
                          <a
                            href={p.platformPostUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2 truncate max-w-xs block"
                          >
                            {p.platformPostUrl}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
