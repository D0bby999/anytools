'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'anytools:favorites';

export function useFavoriteTools() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // localStorage unavailable
    }
    setHydrated(true);
  }, []);

  const persist = (next: string[]) => {
    setFavorites(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const isFavorite = useCallback((slug: string) => favorites.includes(slug), [favorites]);

  const toggle = useCallback(
    (slug: string) => {
      persist(
        favorites.includes(slug) ? favorites.filter((s) => s !== slug) : [...favorites, slug],
      );
    },
    [favorites],
  );

  return { favorites, isFavorite, toggle, hydrated };
}
