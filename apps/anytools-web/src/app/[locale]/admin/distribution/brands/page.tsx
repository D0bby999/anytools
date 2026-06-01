import { requireAdmin } from '@/lib/auth-guards';
import { type BrandRow, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Brands — Distribution Admin' };

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  archived: 'bg-muted text-muted-foreground',
};

export default async function BrandsListPage({ params }: { params: Promise<{ locale: string }> }) {
  const session = await requireAdmin();
  const { locale } = await params;
  const api = createDistributionApi({ actorEmail: session.user.email });

  let brands: BrandRow[] | null;
  try {
    brands = await api.getBrands();
  } catch {
    brands = null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Brands</h1>

      {!brands ? (
        <p className="text-destructive text-sm">Could not load brands.</p>
      ) : brands.length === 0 ? (
        <p className="text-muted-foreground text-sm">No brands configured yet.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Slug</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Website</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.slug} className="border-b hover:bg-muted/30">
                <td className="py-2 pr-4 font-mono">{b.slug}</td>
                <td className="py-2 pr-4">{b.name}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[b.status] ?? 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {b.status}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <a
                    href={b.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    {b.websiteUrl}
                  </a>
                </td>
                <td className="py-2 flex gap-3">
                  <Link
                    href={`/${locale}/admin/distribution/brands/${b.slug}`}
                    className="text-primary underline underline-offset-2"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/${locale}/admin/distribution/brands/${b.slug}/posts`}
                    className="text-primary underline underline-offset-2"
                  >
                    Posts
                  </Link>
                  <Link
                    href={`/${locale}/admin/distribution/brands/${b.slug}/credentials`}
                    className="text-primary underline underline-offset-2"
                  >
                    Credentials
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
