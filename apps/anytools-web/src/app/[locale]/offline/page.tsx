import type { Metadata } from 'next';
import { OfflineContent } from './offline-content';

// No SEO value in an offline fallback page, and 4 near-identical locale copies of it would
// otherwise be indexable, thin-content duplicates (review finding #12) — same treatment as
// other utility pages in this app, e.g. favorites/page.tsx and dashboard/page.tsx.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineContent />;
}
