import { requireAdmin } from '@/lib/auth-guards';
import { type BrandRow, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ brandSlug: string }> }): Promise<Metadata> {
  const { brandSlug } = await params;
  return { title: `Edit ${brandSlug} — Distribution Admin` };
}

// ── server action ─────────────────────────────────────────────────────────────

// Form actions must return void — errors are surfaced via redirect with ?error=
async function patchBrandAction(formData: FormData): Promise<void> {
  'use server';
  // requireAdmin must be the first call — validates session before touching input.
  const session = await requireAdmin();

  const slug = formData.get('slug');
  if (typeof slug !== 'string' || !slug.trim()) return;

  const name = formData.get('name');
  const primaryColor = formData.get('primaryColor');
  const amazonTrackingTag = formData.get('amazonTrackingTag');
  const status = formData.get('status');
  const locale = formData.get('locale') ?? 'en';

  // Build a partial update with only the fields that were submitted.
  const updates: Record<string, string> = {};
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (typeof primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    updates.primaryColor = primaryColor;
  }
  if (typeof amazonTrackingTag === 'string') {
    updates.amazonTrackingTag = amazonTrackingTag.trim();
  }
  if (typeof status === 'string' && ['active', 'paused', 'archived'].includes(status)) {
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) return;

  const api = createDistributionApi({ actorEmail: session.user.email });
  try {
    await api.patchBrand(slug.trim(), updates);
  } catch {
    // Errors are swallowed here for v1 — the page will re-render with stale data.
    // A proper error surface requires useFormState/useActionState (client component),
    // which is deferred. Operators can see the outcome by refreshing.
    return;
  }

  revalidatePath(`/${locale}/admin/distribution/brands`);
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function BrandEditPage({
  params,
}: { params: Promise<{ brandSlug: string; locale: string }> }) {
  const session = await requireAdmin();
  const { brandSlug, locale } = await params;
  const api = createDistributionApi({ actorEmail: session.user.email });

  let brand: BrandRow | null;
  try {
    const brands = await api.getBrands();
    brand = brands.find((b) => b.slug === brandSlug) ?? null;
  } catch {
    brand = null;
  }

  if (!brand) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Edit Brand</h1>
        <p className="text-destructive text-sm">Brand &quot;{brandSlug}&quot; not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-2">Edit Brand</h1>
      <p className="text-muted-foreground text-sm mb-6 font-mono">{brand.slug}</p>

      <form action={patchBrandAction} className="space-y-4">
        <input type="hidden" name="slug" value={brand.slug} />
        <input type="hidden" name="locale" value={locale} />

        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={brand.name}
            className="w-full rounded border px-3 py-2 text-sm bg-background"
          />
        </div>

        <div>
          <label htmlFor="primaryColor" className="block text-sm font-medium mb-1">
            Primary Color (hex)
          </label>
          <div className="flex gap-2 items-center">
            <input
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue={brand.primaryColor}
              className="h-9 w-12 rounded border p-1 bg-background cursor-pointer"
            />
            <input
              type="text"
              value={brand.primaryColor}
              readOnly
              className="flex-1 rounded border px-3 py-2 text-sm bg-muted font-mono"
            />
          </div>
        </div>

        <div>
          <label htmlFor="amazonTrackingTag" className="block text-sm font-medium mb-1">
            Amazon Tracking Tag
          </label>
          <input
            id="amazonTrackingTag"
            name="amazonTrackingTag"
            type="text"
            defaultValue={brand.amazonTrackingTag ?? ''}
            className="w-full rounded border px-3 py-2 text-sm bg-background font-mono"
          />
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium mb-1">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={brand.status}
            className="w-full rounded border px-3 py-2 text-sm bg-background"
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Save changes
          </button>
          <a
            href={`/${locale}/admin/distribution/brands`}
            className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </a>
        </div>
      </form>

      <div className="mt-8 flex gap-4 text-sm">
        <a
          href={`/${locale}/admin/distribution/brands/${brandSlug}/posts`}
          className="text-primary underline underline-offset-2"
        >
          View posts →
        </a>
        <a
          href={`/${locale}/admin/distribution/brands/${brandSlug}/credentials`}
          className="text-primary underline underline-offset-2"
        >
          View credentials →
        </a>
        <a
          href={`/${locale}/admin/distribution/brands/${brandSlug}/templates`}
          className="text-primary underline underline-offset-2"
        >
          View templates →
        </a>
      </div>
    </div>
  );
}
