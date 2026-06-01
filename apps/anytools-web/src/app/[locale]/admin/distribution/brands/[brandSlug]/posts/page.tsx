import { requireAdmin } from '@/lib/auth-guards';
import {
  type PostRow,
  type PostsFilter,
  createDistributionApi,
  validatePostsFilter,
} from '@/lib/distribution-api';
import type { Metadata } from 'next';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ brandSlug: string }> }): Promise<Metadata> {
  const { brandSlug } = await params;
  return { title: `Posts — ${brandSlug} — Distribution Admin` };
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'text-blue-600',
  in_flight: 'text-yellow-600',
  posted: 'text-green-600',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
};

interface PageProps {
  params: Promise<{ brandSlug: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BrandPostsPage({ params, searchParams }: PageProps) {
  const session = await requireAdmin();
  const { brandSlug, locale } = await params;
  const rawQuery = await searchParams;

  // Validate filter params at the page boundary before passing to the API client.
  let filter: PostsFilter;
  try {
    filter = validatePostsFilter({
      platform: typeof rawQuery.platform === 'string' ? rawQuery.platform : undefined,
      status: typeof rawQuery.status === 'string' ? rawQuery.status : undefined,
      from: typeof rawQuery.from === 'string' ? rawQuery.from : undefined,
      to: typeof rawQuery.to === 'string' ? rawQuery.to : undefined,
    });
  } catch {
    filter = {};
    // Invalid query params are silently cleared — no need to show a hard error
    // for a simple mistyped URL param.
  }

  const api = createDistributionApi({ actorEmail: session.user.email });
  let posts: PostRow[] | null;
  try {
    posts = await api.getPosts(brandSlug, filter);
  } catch {
    posts = null;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          Posts — <span className="font-mono capitalize">{brandSlug}</span>
        </h1>
        <Link
          href={`/${locale}/admin/distribution/brands/${brandSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← back to brand
        </Link>
      </div>

      {/* Filter bar — GET form so filters persist in URL and can be bookmarked */}
      <form method="GET" className="flex flex-wrap gap-3 mb-6 text-sm">
        <select
          name="status"
          defaultValue={filter.status ?? ''}
          className="rounded border px-2 py-1.5 bg-background text-sm"
        >
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_flight">In flight</option>
          <option value="posted">Posted</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          name="platform"
          type="text"
          placeholder="Platform (e.g. pinterest)"
          defaultValue={filter.platform ?? ''}
          className="rounded border px-2 py-1.5 bg-background text-sm w-44"
        />
        <input
          name="from"
          type="date"
          defaultValue={filter.from ? filter.from.slice(0, 10) : ''}
          className="rounded border px-2 py-1.5 bg-background text-sm"
        />
        <input
          name="to"
          type="date"
          defaultValue={filter.to ? filter.to.slice(0, 10) : ''}
          className="rounded border px-2 py-1.5 bg-background text-sm"
        />
        <button
          type="submit"
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          Filter
        </button>
        <a href="?" className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Clear
        </a>
      </form>

      {!posts ? (
        <p className="text-destructive text-sm">Could not load posts.</p>
      ) : posts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No posts match the current filter.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Platform</th>
              <th className="py-2 pr-4">Blog slug</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Scheduled</th>
              <th className="py-2 pr-4">Retries</th>
              <th className="py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className="border-b hover:bg-muted/30">
                <td className="py-2 pr-4 font-mono">{p.platformId}</td>
                <td className="py-2 pr-4 truncate max-w-[160px]">{p.blogSlug}</td>
                <td className={`py-2 pr-4 font-medium ${STATUS_COLORS[p.status] ?? ''}`}>
                  {p.status}
                </td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">
                  {new Date(p.scheduledFor).toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-center">{p.retryCount}</td>
                <td className="py-2">
                  <Link
                    href={`/${locale}/admin/distribution/brands/${brandSlug}/posts/${p.id}`}
                    className="text-primary underline underline-offset-2"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
