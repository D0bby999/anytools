import { requireAdmin } from '@/lib/auth-guards';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

// Credentials are brand-scoped (reached from each brand's page), so there is no
// top-level Credentials route — listing one here would be a dead link.
const NAV_LINKS = [
  { href: '/admin/distribution', label: 'Dashboard' },
  { href: '/admin/distribution/brands', label: 'Brands' },
] as const;

export default async function DistributionAdminLayout({ children, params }: Props) {
  // Guard: must be called before any rendering. Redirects to /sign-in if the
  // session is absent or the email is not in DISTRIBUTION_ADMIN_EMAILS.
  const session = await requireAdmin();
  const { locale } = await params;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-muted/40 px-4 py-3">
        <div className="container mx-auto flex items-center gap-6">
          <span className="font-semibold text-sm">Distribution Admin</span>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={`/${locale}${href}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {label}
            </Link>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{session.user.email}</span>
        </div>
      </nav>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
