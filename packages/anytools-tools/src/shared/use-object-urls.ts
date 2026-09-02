'use client';
import { useEffect, useRef } from 'react';

/**
 * Track object URLs and revoke them when the component unmounts.
 *
 * Every file tool hands the user a download link built with `URL.createObjectURL`. That URL
 * pins the entire blob for the lifetime of the *document*, and client-side navigation does not
 * discard the document — so leaving a page without revoking keeps the blob alive until a full
 * reload. `pdf-to-png` creates one URL per rendered page plus a zip, so a 100-page render at
 * 300 DPI strands hundreds of megabytes, repeatably.
 *
 * image-format-converter already did this (its "Cleanup object URL on unmount" effect); the
 * nine tools added afterwards each dropped it. A hook rather than nine copies of the effect.
 *
 * Replacing a URL mid-session is still the caller's job — they know when the old result stops
 * being reachable. This is the backstop for the case no caller can handle from inside.
 */
export function useObjectUrls() {
  const urls = useRef(new Set<string>());

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );

  return {
    /** Create a tracked object URL. */
    create(blob: Blob): string {
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      return url;
    },
    /** Revoke one URL now and stop tracking it. Safe to call with null. */
    revoke(url: string | null | undefined): void {
      if (!url) return;
      URL.revokeObjectURL(url);
      urls.current.delete(url);
    },
    /** Revoke everything created so far — for replacing a whole result set. */
    revokeAll(): void {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
  };
}
