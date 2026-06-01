'use server';

import { requireAdmin } from '@/lib/auth-guards';
import { DistributionApiError, type PostRow, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ brandSlug: string; postId: string }> }): Promise<Metadata> {
  const { brandSlug } = await params;
  return { title: `Post Detail — ${brandSlug} — Distribution Admin` };
}

// ── server actions ─────────────────────────────────────────────────────────────

async function retryPostAction(formData: FormData): Promise<void> {
  'use server';
  // requireAdmin must come first — validates session before reading form input.
  const session = await requireAdmin();

  const brandSlug = formData.get('brandSlug');
  const postId = formData.get('postId');
  const locale = formData.get('locale');

  if (typeof brandSlug !== 'string' || typeof postId !== 'string') return;

  const api = createDistributionApi({ actorEmail: session.user.email });
  try {
    await api.retryPost(brandSlug, postId);
  } catch (err) {
    // For v1 we surface errors via redirect with a simple error param.
    // A toast/flash mechanism would require a client component wrapper — deferred.
    const msg = err instanceof DistributionApiError ? err.message : 'Retry failed';
    redirect(
      `/${locale}/admin/distribution/brands/${brandSlug}/posts/${postId}?error=${encodeURIComponent(msg)}`,
    );
  }

  redirect(
    `/${typeof locale === 'string' ? locale : 'en'}/admin/distribution/brands/${brandSlug}/posts/${postId}?success=retried`,
  );
}

async function cancelPostAction(formData: FormData): Promise<void> {
  'use server';
  const session = await requireAdmin();

  const brandSlug = formData.get('brandSlug');
  const postId = formData.get('postId');
  const locale = formData.get('locale');

  if (typeof brandSlug !== 'string' || typeof postId !== 'string') return;

  const api = createDistributionApi({ actorEmail: session.user.email });
  try {
    await api.cancelPost(brandSlug, postId);
  } catch (err) {
    const msg = err instanceof DistributionApiError ? err.message : 'Cancel failed';
    redirect(
      `/${locale}/admin/distribution/brands/${brandSlug}/posts/${postId}?error=${encodeURIComponent(msg)}`,
    );
  }

  redirect(
    `/${typeof locale === 'string' ? locale : 'en'}/admin/distribution/brands/${brandSlug}/posts/${postId}?success=cancelled`,
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ brandSlug: string; postId: string; locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function PostDetailPage({ params, searchParams }: PageProps) {
  const session = await requireAdmin();
  const { brandSlug, postId, locale } = await params;
  const { error, success } = await searchParams;

  const api = createDistributionApi({ actorEmail: session.user.email });

  let post: PostRow;
  try {
    post = await api.getPost(brandSlug, postId);
  } catch (err) {
    const status = err instanceof DistributionApiError ? err.status : 0;
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Post Detail</h1>
        <p className="text-destructive text-sm">
          {status === 404 ? 'Post not found for this brand.' : 'Could not load post.'}
        </p>
      </div>
    );
  }

  const canRetry = post.status === 'failed';
  const canCancel = post.status === 'scheduled' || post.status === 'failed';

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Post Detail</h1>
        <a
          href={`/${locale}/admin/distribution/brands/${brandSlug}/posts`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← back to posts
        </a>
      </div>

      {success && (
        <div className="mb-4 rounded bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
          {success === 'retried' ? 'Post re-queued successfully.' : 'Post cancelled.'}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Summary */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-6">
        <dt className="text-muted-foreground">Brand</dt>
        <dd className="font-mono">{post.brandSlug}</dd>

        <dt className="text-muted-foreground">Platform</dt>
        <dd className="font-mono">{post.platformId}</dd>

        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-medium">{post.status}</dd>

        <dt className="text-muted-foreground">Blog slug</dt>
        <dd className="font-mono truncate">{post.blogSlug}</dd>

        <dt className="text-muted-foreground">Scheduled for</dt>
        <dd>{new Date(post.scheduledFor).toLocaleString()}</dd>

        <dt className="text-muted-foreground">Posted at</dt>
        <dd>{post.postedAt ? new Date(post.postedAt).toLocaleString() : '—'}</dd>

        <dt className="text-muted-foreground">Retry count</dt>
        <dd>{post.retryCount}</dd>

        <dt className="text-muted-foreground">Next retry at</dt>
        <dd>{post.nextRetryAt ? new Date(post.nextRetryAt).toLocaleString() : '—'}</dd>

        {post.platformPostUrl && (
          <>
            <dt className="text-muted-foreground">Platform URL</dt>
            <dd>
              <a
                href={post.platformPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 truncate block"
              >
                {post.platformPostUrl}
              </a>
            </dd>
          </>
        )}

        {post.failureReason && (
          <>
            <dt className="text-muted-foreground">Failure reason</dt>
            <dd className="text-destructive">{post.failureReason}</dd>
          </>
        )}
      </dl>

      {/* Content payload — read-only JSON dump, no raw HTML rendering */}
      <details className="mb-6">
        <summary className="cursor-pointer text-sm font-medium mb-2">Content payload</summary>
        <pre className="rounded border bg-muted px-4 py-3 text-xs overflow-x-auto">
          {JSON.stringify(post.contentPayload, null, 2)}
        </pre>
      </details>

      {/* Actions */}
      <div className="flex gap-3">
        <form action={retryPostAction}>
          <input type="hidden" name="brandSlug" value={brandSlug} />
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            disabled={!canRetry}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40 hover:opacity-90"
          >
            Retry
          </button>
        </form>

        <form action={cancelPostAction}>
          <input type="hidden" name="brandSlug" value={brandSlug} />
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            disabled={!canCancel}
            className="rounded border border-destructive px-4 py-2 text-sm font-medium text-destructive disabled:opacity-40 hover:bg-destructive/10"
          >
            Cancel
          </button>
        </form>
      </div>

      {!canRetry && post.status !== 'failed' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Retry is only available for posts with status &quot;failed&quot;.
        </p>
      )}
      {!canCancel && (
        <p className="mt-3 text-xs text-muted-foreground">
          Cancel is only available for &quot;scheduled&quot; or &quot;failed&quot; posts. Posts that
          are in-flight or already published cannot be cancelled.
        </p>
      )}
    </div>
  );
}
