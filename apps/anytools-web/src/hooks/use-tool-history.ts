'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'anytools:history';
const MAX = 15;

export type HistoryEntry = {
  slug: string;
  cluster: string;
  visitedAt: number; // epoch ms
};

export function useToolHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // localStorage unavailable
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((next: HistoryEntry[]) => {
    setHistory(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const record = useCallback(
    (slug: string, cluster: string) => {
      // Read fresh from storage to avoid stale closure on first mount
      let current: HistoryEntry[] = [];
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) current = JSON.parse(raw);
      } catch {
        // ignore
      }
      // Move-to-front strategy
      const filtered = current.filter((e) => e.slug !== slug);
      const next = [{ slug, cluster, visitedAt: Date.now() }, ...filtered].slice(0, MAX);
      persist(next);
    },
    [persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { history, record, clear, hydrated };
}
