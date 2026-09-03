import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// A dedicated layout, not just the guard already inline at the top of page.tsx, because
// the sibling `loading.tsx` wraps page.tsx's OUTPUT in a Suspense boundary — once that
// boundary starts streaming, a later notFound() thrown from inside page.tsx renders the
// not-found UI but the response has already committed to HTTP 200 (a documented Next.js
// limitation: vercel/next.js#45801, still open). A layout's own body runs BEFORE the
// Suspense boundary it wraps `children` in, so gating here produces a real 404 status —
// the same mechanism `admin/distribution/layout.tsx` already relies on. No-op for hosted
// requests (IS_SELF_HOSTED is false): renders `children` straight through.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  if (IS_SELF_HOSTED) notFound();
  return children;
}
