'use client';
import { useToolHistory } from '@/hooks/use-tool-history';
import { useEffect } from 'react';

/** Records the current tool visit to localStorage once on mount. SSR-safe (no-op server-side). */
export function TrackToolVisit({ slug, cluster }: { slug: string; cluster: string }) {
  const { record } = useToolHistory();
  useEffect(() => {
    record(slug, cluster);
  }, [slug, cluster, record]);
  return null;
}
